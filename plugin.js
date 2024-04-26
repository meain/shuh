let audioFor = {};

let skip = 0;
let currentTrack = undefined;
let player = undefined;
let playerText = undefined;

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

    // Add control like next and prev and some text for currently
    // playing track and a progress bar
    const div = document.createElement("div");
    const idiv = document.createElement("idiv");
    idiv.appendChild(prev);
    idiv.appendChild(next);
    idiv.appendChild(playerText);
    div.appendChild(idiv);
    div.appendChild(player);

    player.style.width = "100%";
    idiv.style.width = "100%";
    idiv.style.fontSize = "13px"; // TODO: rethink

    next.style.margin = "5px";
    prev.style.margin = "5px";
    playerText.style.margin = "5px";

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
        const blob = await response.blob();
        console.log("Fetched", text.substring(0, 13));
        return blob;
    } catch (error) {
        throw error;
    }
}

function waitFor(arr, index) {
    return new Promise((resovlve, reject) => {
        if (arr[index] == undefined) {
            setTimeout(() => {
                playerText.textContent =
                    "Waiting for audio: " + index.substring(0, 33) + "...";
                waitFor(arr, index).then(resovlve);
            }, 1000);
        } else {
            resovlve();
        }
    });
}

function fetchAudio(elems) {
    return new Promise(async (res, rej) => {
        const count = elems.length;

        for (let i = 0; i < count; i++) {
            let e = elems[i];

            let text = e.textContent;

            if (text.length === 0) {
                continue;
            }

            console.log("Fetching", text.substring(0, 13));
            audioFor[text] = await tts(text);
        }
    });
}

async function processItems(elems) {
    const count = elems.length;

    for (let i = 0; i < count; i++) {
        let e = elems[i];
        let text = e.textContent;

        // highlight
        orig = e.style.backgroundColor;
        e.style.backgroundColor = "#f1f1f1";
        e.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
        });

        if (audioFor[text] == undefined) {
            await waitFor(audioFor, text);
        }

        playerText.textContent =
            "Playing section(" +
            i +
            "/" +
            count +
            "): " +
            text.substring(0, 33) +
            "...";
        await playAudio(audioFor[text]);

        if (skip == -1) {
            i -= 2;
            skip = 0;
        }

        // unhighlight
        e.style.backgroundColor = orig;
    }
}

const all = document.querySelectorAll("p,ol,ul,pre,h1,h2,h3,h4,h5,h6");
const elems = Array.from(all).filter((e) => e.textContent.length > 0);

fetchAudio(elems);
createAudioPlayer();
processItems(elems);
