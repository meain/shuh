elems = document.querySelectorAll("p,ol,ul,pre,h1,h2,h3,h4,h5,h6");

function tts(text) {
    return new Promise((resolve, reject) => {
        // send the text to localhost:3333 and get audio back to be
        // played via browser. The request is supposed to be a POST
        // request with "text" as the key
        console.log(text)
        fetch("http://localhost:3333/audio", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ text }),
        })
            .then((response) => response.blob())
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.play();
                audio.onended = () => {
                    URL.revokeObjectURL(url);
                    resolve();
                };
            })
            .catch((err) => {
                console.error(err);
                resolve();
            });

        // setTimeout(() => resolve(), 1000);
    });
}

function processItems(elems, index) {
    const e = elems[index];
    if (e === undefined) {
        console.log("Processing completed!");
        return;
    }

    const text = e.textContent;

    if (text.length === 0) {
        processItems(elems, index + 1);
        return;
    }

    orig = e.style.backgroundColor;
    e.style.backgroundColor = "#f1f1f1";
    e.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
    });

    tts(text).then(() => {
        e.style.backgroundColor = orig;
        processItems(elems, index + 1);
    });
}

processItems(elems, 0);