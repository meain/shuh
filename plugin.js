let audioFor = {};

function playAudio(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
        };
        audio.play();
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
                console.log("Waiting for", index.substring(0, 13));
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
            let audio = await tts(text);
            audioFor[text] = audio;
        }
    });
}

async function processItems() {
    const all = document.querySelectorAll("p,ol,ul,pre,h1,h2,h3,h4,h5,h6");
    const elems = Array.from(all).filter((e) => e.textContent.length > 0);
    const count = elems.length;

    fetchAudio(elems);

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

        console.log("Playing", text.substring(0, 13));
        await playAudio(audioFor[text]);

        // unhighlight
        e.style.backgroundColor = orig;
    }
}

processItems();
