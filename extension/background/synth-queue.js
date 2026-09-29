// Serial, prioritised queue in front of predict(). ORT runs single-threaded
// here, so concurrent predict() calls just interleave and the sentence the
// user is waiting on ends up behind whatever was prefetched before it.
//
// Each job belongs to a player `session` and carries that player's `gen`
// (bumped on every next/prev). Queued jobs from an older gen are dropped
// before predict() runs; a job already inside predict() can't be aborted
// and is allowed to finish (its audio is still valid for that sentence).
//
// Pick order: urgent (the sentence at the player's cursor) → normal
// (lookahead) → low (warmup), FIFO within each tier.

export const STALE = "stale";

const TIER = { urgent: 0, normal: 1, low: 2 };

export function createSynthQueue({ predict, defer = (fn) => setTimeout(fn, 0) }) {
  const queued = [];            // pending jobs, not yet in predict()
  const byKey = new Map();      // `${session}:${idx}` → job (queued or running)
  const latestGen = new Map();  // session → newest gen seen
  let running = false;
  let pumpScheduled = false;
  let seq = 0;

  function staleError() {
    const err = new Error(STALE);
    err.stale = true;
    return err;
  }

  function forget(job) {
    if (job.key && byKey.get(job.key) === job) byKey.delete(job.key);
  }

  function drop(pred) {
    for (let i = queued.length - 1; i >= 0; i--) {
      const job = queued[i];
      if (!pred(job)) continue;
      queued.splice(i, 1);
      forget(job);
      job.reject(staleError());
    }
  }

  // Record a newer gen for `session` and drop everything it made stale.
  function advance(session, gen) {
    if (session == null || gen == null) return;
    const cur = latestGen.get(session);
    if (cur != null && gen <= cur) return;
    latestGen.set(session, gen);
    drop((job) => job.session === session && job.gen < gen);
  }

  // Drop all queued work for a session (player closed).
  function cancelSession(session) {
    if (session == null) return;
    latestGen.delete(session);
    drop((job) => job.session === session);
  }

  function schedule() {
    if (running || pumpScheduled) return;
    pumpScheduled = true;
    // Deferred so requests that arrive together (warmup + first synth)
    // are all queued before the first pick.
    defer(pump);
  }

  function pickNext() {
    let best = -1;
    for (let i = 0; i < queued.length; i++) {
      const a = queued[i];
      const b = queued[best];
      if (best < 0 || a.tier < b.tier || (a.tier === b.tier && a.seq < b.seq)) best = i;
    }
    return best < 0 ? null : queued.splice(best, 1)[0];
  }

  async function pump() {
    pumpScheduled = false;
    if (running) return;
    running = true;
    try {
      let job;
      while ((job = pickNext())) {
        // Last line of defence — advance() already drops these eagerly.
        const gen = latestGen.get(job.session);
        if (job.session != null && job.gen != null && gen != null && job.gen < gen) {
          forget(job);
          job.reject(staleError());
          continue;
        }
        try {
          job.resolve(await predict({ text: job.text, voiceId: job.voiceId }));
        } catch (err) {
          job.reject(err);
        } finally {
          forget(job);
        }
      }
    } finally {
      running = false;
    }
  }

  // Enqueue a synthesis job. `session`/`gen`/`idx` are optional; without
  // them the job is never considered stale and never deduped.
  function enqueue({ text, voiceId, session, gen, idx, priority = "normal" }) {
    if (session != null && gen != null) {
      advance(session, gen);
      const cur = latestGen.get(session);
      if (gen < cur) return Promise.reject(staleError());
    }
    const tier = TIER[priority] ?? TIER.normal;
    const key = session != null && idx != null ? `${session}:${idx}` : null;
    const existing = key && byKey.get(key);
    if (existing && existing.text === text && existing.voiceId === voiceId) {
      // Same sentence requested again (e.g. lookahead becoming the cursor):
      // share the in-flight/queued job, but let it inherit the higher
      // priority and newer gen.
      if (tier < existing.tier) existing.tier = tier;
      if (gen != null && (existing.gen == null || gen > existing.gen)) existing.gen = gen;
      return existing.promise;
    }
    const job = { text, voiceId, session, gen, key, tier, seq: seq++ };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    queued.push(job);
    if (key) byKey.set(key, job);
    schedule();
    return job.promise;
  }

  return {
    enqueue,
    advance,
    cancelSession,
    get pending() { return queued.length; },
    get busy() { return running; },
  };
}
