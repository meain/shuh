const pluginStyle = `
.audio-player {
position: fixed;
display: flex;
justify-content: center;
align-items: center;
bottom: 0px;
width: 100%;
height: 40px;
padding: 1px 2px;
background: #000;
z-index: 1000;
}
.audio-player button {
margin: 3px;
padding: 0 2px;
}

.audio-player span {
font-size: 0.8rem;
color: white;
flex: 1;
padding: 0 5px;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
}

.shuh-highlight {
background-color: #f1f1f1;
color: #000000;
border-radius: 4px;
}
`;

async function tts(text) {
    try {
        // Send the text to localhost:3333 and get audio back to be
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

function stripUnwanted(elems) {
    const unwanted = new Set(["NAV", "ASIDE"]);

    return elems.filter((el) => {
        let parent = el;
        for (let i = 0; i < 10 && parent.tagName !== "BODY"; i++) {
            if (unwanted.has(parent.tagName)) return false;
            parent = parent.parentElement;
        }
        return true;
    });
}

class AudioPlayer {
    constructor() {
        this.embedStyle();

        this.player = document.createElement("audio");
        this.player.controls = false; // remove native controls
        this.controls = this.createPlayer();
        document.body.appendChild(this.controls);

        this.blobs = [];
        this.playing = true;
        this.playerPosition = 0;
    }

    embedStyle() {
        const style = document.createElement("style");
        style.textContent = pluginStyle;
        document.head.appendChild(style);
    }

    createButton(label) {
        const btn = document.createElement("button");
        btn.textContent = label;
        return btn;
    }

    createPlayer() {
        const div = document.createElement("div");
        div.classList.add("audio-player");

        this.info = document.createElement("span");
        this.info.textContent = "Initializing player..."

        const play = this.createButton("pause");
        const prev = this.createButton("prev");
        const next = this.createButton("next");

        play.onclick = () => {
            if (this.playing) {
                this.player.pause();
                play.textContent = "play";
                this.playing = false;
            } else {
                this.player.play();
                play.textContent = "pause";
                this.playing = true;
            }
        };

        next.onclick = () => {
            this.player.onended();
        };

        prev.onclick = () => {
            if (this.playerPosition == 0) {
                return;
            }

            this.playerPosition -= 2; // double minus so that the loop with increment by one
            this.player.onended();
        };

        div.appendChild(play);
        div.appendChild(prev);
        div.appendChild(next);
        div.appendChild(this.info);

        return div;
    }

    async fetchAudio() {
        for (let b in this.blocks) {
            const text = this.blocks[b].textContent;
            let chunks = text.split(". ");
            chunks = chunks.filter((e) => e.trim().length > 0);

            for (let c in chunks) {
                const chunk = chunks[c];
                const blob = await tts(chunks[c]);
                const data = { b, chunk, blob };
                this.blobs.push(data);
            }
        }
    }

    // Wait until a blob is available. Using this.playerPosition so
    // that next and prev will work reliably
    async waitFor() {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        while (true) {
            // Check of off by one errors
            if (this.playerPosition < this.blobs.length) break;
            await sleep(1000);
        }
    }

    highlightBlock() {
        const { b } = this.blobs[this.playerPosition];
        const block = this.blocks[b];

        // Remove the class from all elements
        Object.values(this.blocks).forEach((b) =>
            b.classList.remove("shuh-highlight"),
        );

        block.classList.add("shuh-highlight");
    }

    playCurrent() {
        return new Promise((res) => {
            let { b, chunk, blob } = this.blobs[this.playerPosition];

            this.player.pause();
            if (this.track != undefined) {
                URL.revokeObjectURL(this.track);
            }

            let info = `[${b}/${this.blocks.length}] ${chunk}`;

            this.info.textContent = info;
            this.track = URL.createObjectURL(blob);
            this.player.src = this.track;
            this.player.play();
            this.player.onended = res;
        });
    }

    async playAudio() {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        while (true) {
            await this.waitFor();
            await sleep(100); // a tiny break between lines
            this.highlightBlock()
            await this.playCurrent();
            this.playerPosition += 1;
        }
    }

    play() {
        const all = document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6");
        let elems = stripUnwanted(Array.from(all));
        elems = elems.filter((e) => e.textContent.trim().length > 0);

        this.blocks = elems;
        this.fetchAudio().then(() => {
            console.log("All audio segments fetched");
        });

        this.playAudio(); // this never returns
    }
}

new AudioPlayer().play()
