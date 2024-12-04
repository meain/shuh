let audioFor = {};

let skip = 0;
let currentTrack = undefined;
let player = undefined;
let playerText = undefined;
let fetchedText = undefined;

// Create a div at the start of the bottom of the body, always visible
// with an audio player and return the handle to the player.
function createAudioPlayer() {
    const body = document.querySelector("body");

    player = document.createElement("audio");
    player.controls = true;

    const next = document.createElement("button");
    next.textContent = "Next";
    next.onclick = () => {
        player.pause();
        player.onended();
    };

    const prev = document.createElement("button");
    prev.textContent = "Prev";
    prev.onclick = () => {
        skip = -1;
        player.pause();
        player.onended();
    };

    playerText = document.createElement("span");
    playerText.textContent = "Fetching audio...";

    fetchedText = document.createElement("span");

    // Add control like next and prev and some text for currently
    // playing track and a progress bar
    const div = document.createElement("div");
    const idiv = document.createElement("idiv");
    idiv.appendChild(prev);
    idiv.appendChild(next);
    idiv.appendChild(playerText);
    idiv.appendChild(fetchedText);
    div.appendChild(idiv);
    div.appendChild(player);

    player.style.width = "100%";
    idiv.style.width = "100%";
    idiv.style.fontSize = "0.6em";
    idiv.style.display = "flex";

    next.style.margin = "5px";
    prev.style.margin = "5px";
    playerText.style.margin = "5px";
    playerText.style.flex = "1";
    fetchedText.style.margin = "5px";

    div.style.position = "fixed";
    div.style.bottom = "0";
    div.style.left = "0";
    div.style.width = "100%";
    div.style.backgroundColor = "black";
    div.style.color = "white";
    div.style.zIndex = "1000";
    div.style.display = "flex";
    div.style.justifyContent = "center";
    div.style.alignItems = "center";
    div.style.flexDirection = "column";

    body.appendChild(div);

    return player;
}

function playAudio(blob) {
    return new Promise((resolve, reject) => {
        if (currentTrack != undefined) {
            URL.revokeObjectURL(currentTrack);
        }

        currentTrack = URL.createObjectURL(blob);
        player.src = currentTrack;
        player.onended = resolve;
        player.play();
    });
}

async function tts(text) {
    try {
        // send the text to localhost:3333 and get audio back to be
        // played via browser. The request is supposed to be a POST
        // request with "text" as the key
        const response = await fetch("http://localhost:3333/audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        return await response.blob();
    } catch (error) {
        throw error;
    }
}

function waitFor(arr, text) {
    return new Promise((resolve, reject) => {
        if (arr[text] == undefined) {
            setTimeout(() => {
                playerText.textContent =
                    "Waiting for audio: " + text.substring(0, 33) + "...";
                waitFor(arr, text).then(resolve);
            }, 1000);
        } else {
            resolve();
        }
    });
}

function splitIntoPeriodSentences(text) {
    // Split text into sentences, keeping the periods
    return text.match(/[^.]+\./g) || [];
}

function fetchAudio(elems) {
    return new Promise(async (res, rej) => {
        const count = elems.length;

        for (let i = 0; i < count; i++) {
            let e = elems[i];

            // Split the text into sentences by periods
            const sentences = splitIntoPeriodSentences(e.textContent.trim());

            for (const sentence of sentences) {
                if (sentence.trim().length === 0) {
                    continue;
                }

                // Fetch audio for each sentence separately
                audioFor[sentence] = await tts(sentence);
                fetchedText.textContent = `Fetched (${i}/${count})`;
            }
        }
        res();
    });
}

async function processItems(elems) {
    const count = elems.length;

    for (let i = 0; i < count; i++) {
        let e = elems[i];
        // Split the text into sentences by periods
        const sentences = splitIntoPeriodSentences(e.textContent.trim());

        for (const sentence of sentences) {
            if (sentence.trim().length === 0) {
                continue;
            }

            // Unhighlight all elements first
            elems.forEach(elem => {
                elem.style.backgroundColor = elem.getAttribute('data-orig-bg') || '';
            });

            // Highlight current element
            const orig = e.style.backgroundColor;
            e.setAttribute('data-orig-bg', orig);
            e.style.backgroundColor = "#f1f1f1";
            e.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "nearest",
            });

            if (audioFor[sentence] == undefined) {
                await waitFor(audioFor, sentence);
            }

            playerText.textContent =
                `Playing(${i}/${count}): ${sentence.substring(0, 33)}...`;
            await playAudio(audioFor[sentence]);

            if (skip == -1) {
                i -= 2;
                skip = 0;
                break;
            }
        }
    }
}

function stripUnwanted(elems) {
    const unwanted = ["NAV", "ASIDE"];
    const filtered = [];

    // check 10 levels deep
    for (let el of elems) {
        let parent = el;
        let i = 0;
        let skip = false;
        while (parent.tagName != "BODY" && i < 10) {
            if (unwanted.includes(parent.tagName)) {
                skip = true;
                break;
            }

            parent = parent.parentElement;
            i++;
        }

        if (skip) continue;
        filtered.push(el);
    }

    return filtered;
}

const all = document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6");
let elems = Array.from(all).filter((e) => e.textContent.trim().length > 0);
elems = stripUnwanted(elems);

fetchAudio(elems);
createAudioPlayer();
processItems(elems);
