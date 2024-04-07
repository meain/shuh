package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

// This is a simple server to run the piper cli and return the wav
// file back

type body struct {
	Text string
}

func getAudio(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "3600")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// get text from json request body
	decoder := json.NewDecoder(r.Body)

	var bd body
	err := decoder.Decode(&bd)
	if err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// run piper cli
	errorStream := bytes.Buffer{}
	audio := bytes.Buffer{}
	piperCli := exec.Command("piper", "-m", "/home/meain/.cache/piper/en_US-ryan-high.onnx", "-f", "-")

	piperCli.Stdin = strings.NewReader(bd.Text)
	piperCli.Stderr = &errorStream
	piperCli.Stdout = &audio

	err = piperCli.Run()
	if err != nil {
		fmt.Println(err)
		fmt.Println(errorStream.String())
		http.Error(w, "Error running piper cli", http.StatusInternalServerError)
		return
	}

	// return audio
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Content-Disposition", "attachment; filename=audio.wav")
	w.Write(audio.Bytes())
}

func main() {
	http.HandleFunc("/audio", getAudio)

	err := http.ListenAndServe(":3333", nil)
	if err != nil {
		panic(err)
	}
}
