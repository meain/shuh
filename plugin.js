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

function tts(text) {
    return new Promise((resolve, reject) => {
        // send the text to localhost:3333 and get audio back to be
        // played via browser. The request is supposed to be a POST
        // request with "text" as the key
        fetch("http://localhost:3333/audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        })
            .then((response) => response.blob())
            .then((blob) => {
                console.log("Fetched", text);
                resolve(blob);
            })
            .catch(reject);
    });
}

function waitFor(arr, index) {
    return new Promise((resovlve, reject) => {
        if (arr[index] == undefined) {
            setTimeout(() => {
                console.log("Waiting for", index);
                waitFor(arr, index).then(resovlve);
            }, 100);
        } else {
            resovlve();
        }
    });
}

async function processItems() {
    const all = document.querySelectorAll("p,ol,ul,pre,h1,h2,h3,h4,h5,h6");
    const elems = Array.from(all).filter((e) => e.textContent.length > 0);
    const count = elems.length;

    let audioFor = {};

    for (let i = 0; i < count; i++) {
        let e = elems[i];
        let en = elems[i + 1];

        let text = e.textContent;
        let textn = en.textContent;

        if (text.length === 0) {
            continue;
        }

        // highlight
        orig = e.style.backgroundColor;
        e.style.backgroundColor = "#f1f1f1";
        e.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "nearest",
        });

        tts(textn).then((audio) => {
            audioFor[textn] = audio;
        });

        if (audioFor[text] == undefined) {
            if (i === 0) {
                audioFor[text] = await tts(text);
            } else {
                await waitFor(audioFor, text);
            }
        }

        console.log(text);
        await playAudio(audioFor[text]);

        // unhighlight
        e.style.backgroundColor = orig;
    }
}

processItems();
