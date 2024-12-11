const pluginStyle = `
.audio-player {
all: initial; /* remove all other styling */
position: fixed;
display: flex;
justify-content: center;
align-items: center;
bottom: 0px;
width: 100%;
padding: 5px;
background: #000;
z-index: 1000;
font-size: 1em;
}

.audio-player button {
margin: 1px 3px;
padding: 0 2px;
border: none;
border-radius: 4px;
background-color: #f0f0f0;
color: #333;
font-size: 14px;
cursor: pointer;
transition: background-color 0.3s;
}
.audio-player button:hover {
background-color: #e0e0e0;
}

.audio-player span {
color: white;
flex: 1;
padding: 0 5px;
white-space: nowrap;
overflow: hidden;
text-overflow: ellipsis;
cursor: pointer;
}

.shuh-highlight {
background-color: #f1f1f1;
color: #000000;
border-radius: 4px;
border-top: 1px solid black;
border-bottom: 1px solid black;
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
        this.info.textContent = "Initializing player...";

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
            play.textContent = "pause";
            this.playing = true;
        };

        prev.onclick = () => {
            if (this.playerPosition == 0) {
                return;
            }

            this.playerPosition -= 2; // double minus so that the loop with increment by one
            this.player.onended();
            play.textContent = "pause";
            this.playing = true;
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

    isVisible(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0
        );
    }

    scrollIntoView(block) {
        // https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
        block.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
        });
    }

    highlightBlock() {
        const { b } = this.blobs[this.playerPosition];
        const block = this.blocks[b];

        // Remove the class from all elements
        let prevObjVisible = false;
        Object.values(this.blocks).forEach((b) => {
            if (b.classList.contains("shuh-highlight")) {
                b.classList.remove("shuh-highlight");
                prevObjVisible = this.isVisible(b);
            }
        });

        block.classList.add("shuh-highlight");
        if (prevObjVisible) this.scrollIntoView(block);

        // Click on info to scroll to the block
        this.info.onclick = () => this.scrollIntoView(block);
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
            this.highlightBlock();
            await this.playCurrent();
            this.playerPosition += 1;
        }
    }

    play() {
        const all = document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6");
        let elems = stripUnwanted(Array.from(all));
        elems = elems.filter((e) => e.textContent.trim().length > 0);

        // Remove any child elements whose parents are already in the
        // list. This avoids the script from reading the same thing
        // twice.
        elems = elems.filter((e) => {
            // check if any parent of e is already in elems
            let parent = e.parentNode;
            while (parent) {
                if (elems.includes(parent)) {
                    return false;
                }
                parent = parent.parentNode;
            }
            return true;
        });

        this.blocks = elems;
        this.fetchAudio().then(() => {
            console.log("All audio segments fetched");
        });

        this.playAudio(); // this never returns
    }
}

new AudioPlayer().play();
