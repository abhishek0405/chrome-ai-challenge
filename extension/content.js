let ON_CALL = false;
let IS_SUBTITLE_ON = false;
let script = [];
let last_speaker = "";
chrome.storage.sync.set({
  ON_CALL: false,
  subtitleWarning: true,
});
let lastStreamedTimestamp = Math.floor(Date.now() / 1000);
const INTERVAL = 10;

const observerMap = new Map();

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === "extensionEnabled") {
    const isExtensionEnabled = message.isEnabled;
    const captionsButton = contains(
      ".material-icons-extended",
      "closed_caption_off"
    )[0];
    chrome.storage.sync.get(["subtitleWarning"], function (result) {
      console.log("toggling");

      const isSubtitleOff = result.subtitleWarning;
      if (isExtensionEnabled && isSubtitleOff) {
        if (captionsButton) {
          captionsButton.click();
        }
      } else if (!isExtensionEnabled && !isSubtitleOff) {
        if (captionsButton) {
          captionsButton.click();
        }
      }
    });
  }
});

function contains(selector, text) {
  var elements = document.querySelectorAll(selector);
  return Array.prototype.filter.call(elements, function (element) {
    return RegExp(text).test(element.textContent);
  });
}

window.addEventListener("load", function () {
  const observer = new MutationObserver(() => {
    const captionsButton = contains(
      ".material-icons-extended",
      "closed_caption_off"
    )[0];
    if (captionsButton) {
      captionsButton.click();
      observer.disconnect();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
});

const docObserver = new MutationObserver(() => {
  if (document.body.querySelector("div[jscontroller='kAPMuc']")) {
    if (!ON_CALL) {
      ON_CALL = true;
      chrome.runtime.sendMessage({
        action: "activate",
      });

      chrome.storage.sync.set({
        ON_CALL: true,
      });
      callStarts();
    }
  } else {
    if (ON_CALL) {
      ON_CALL = false;
      callEnds();
    }
  }
});

docObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

function whenSubtitleOff() {
  chrome.storage.sync.set({
    subtitleWarning: true,
  });
}

function callStarts() {
  console.log("call started");
  const subtitleDiv = document.querySelector("div[jscontroller='D1tHje']");
  IS_SUBTITLE_ON = subtitleDiv.style.display === "none" ? false : true;
  if (IS_SUBTITLE_ON) whenSubtitleOn();
  else whenSubtitleOff();

  const subtitleOnOff = new MutationObserver(() => {
    IS_SUBTITLE_ON = subtitleDiv.style.display === "none" ? false : true;
    if (IS_SUBTITLE_ON) whenSubtitleOn();
    else whenSubtitleOff();
  });

  subtitleOnOff.observe(subtitleDiv, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["style"],
  });
}

function whenSubtitleOn() {
  console.log("subtitle on");
  chrome.storage.sync.set({
    subtitleWarning: false,
  });
  const subtitleDiv = document.querySelector("div[jscontroller='D1tHje']");
  const subtitleObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.target.classList &&
        mutation.target.classList.contains("bh44bd")
      ) {
        if (mutation.addedNodes.length) {
          var newNodes = mutation.addedNodes;
          var speaker =
            newNodes["0"]?.parentNode?.parentNode?.parentNode?.querySelector(
              ".KcIKyf.jxFHg"
            )?.textContent;
          if (speaker) {
            setTimeout(function () {
              const currentTimestamp = Math.floor(Date.now() / 1000);
              if (newNodes.length) {
                if (last_speaker != speaker) {
                  script.push(speaker + " : " + newNodes["0"].innerText);
                  last_speaker = speaker;
                  lastStreamedTimestamp = currentTimestamp;
                  streamMeetingContext();
                } else {
                  var lastText = script.pop();
                  lastText = lastText.slice(0, -2);
                  lastText = lastText + newNodes["0"].innerText;
                  script.push(lastText);
                  if (currentTimestamp - lastStreamedTimestamp >= INTERVAL) {
                    streamMeetingContext();
                    lastStreamedTimestamp = currentTimestamp;
                  }
                }
              }
            }, 3000);
          }
        }
      }
    });
  });

  if (!observerMap.has(subtitleDiv)) {
    // Start observing subtitle div
    subtitleObserver.observe(subtitleDiv, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });
    observerMap.set(subtitleDiv, subtitleObserver);
  }
}

async function streamMeetingContext() {
  console.log("going to stream ");
  postTranscript(script);
}

async function postTranscript(transcript) {
  console.log("Going to manage transcript: ", transcript);
  // Example of sending data to popup.js
  const data = { key: "transcript", value: transcript };

  // Send message to background or popup script
  chrome.runtime.sendMessage({ type: "TRANSCRIPT", payload: data });
}

async function callEnds() {
  await streamMeetingContext();
  endMeeting();
}

async function endMeeting() {
  console.log("meeting ended");
}







// STREAMING AUDIO CHUNKS

// Service worker sent us the stream ID, use it to get the stream
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   navigator.mediaDevices.getUserMedia({
//       video: false,
//       audio: true,
//       audio: {
//           mandatory: {
//               chromeMediaSource: 'tab',
//               chromeMediaSourceId: request.streamId
//           }
//       }
//   })
//   .then((stream) => {
//       // Once we're here, the audio in the tab is muted
//       // However, recording the audio works!
//       const recorder = new MediaRecorder(stream);
//       const chunks = [];
//       recorder.ondataavailable = (e) => {
//           chunks.push(e.data);
//       };
//       recorder.onstop = (e) => saveToFile(new Blob(chunks), "test.wav");
//       recorder.start();
//       setTimeout(() => recorder.stop(), 5000);
//   });
// });

// function saveToFile(blob, name) {
//   const url = window.URL.createObjectURL(blob);
//   const a = document.createElement("a");
//   document.body.appendChild(a);
//   a.style = "display: none";
//   a.href = url;
//   a.download = name;
//   a.click();
//   URL.revokeObjectURL(url);
//   a.remove();
// }


async function captureAudio() {
  try {
    // Capture microphone audio
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone stream captured:", micStream);

    // Capture tab audio
    const tabStream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
        if (chrome.runtime.lastError || !stream) {
          reject(chrome.runtime.lastError || "Failed to capture tab audio.");
        } else {
          resolve(stream);
        }
      });
    });
    console.log("Tab stream captured:", tabStream);

    // Combine microphone and tab audio into a single MediaStream
    const audioContext = new AudioContext();
    const micSource = audioContext.createMediaStreamSource(micStream);
    const tabSource = audioContext.createMediaStreamSource(tabStream);

    const destination = audioContext.createMediaStreamDestination();
    micSource.connect(destination);
    tabSource.connect(destination);

    const combinedStream = destination.stream;
    console.log("Combined audio stream:", combinedStream);

    // Process the combined audio (e.g., send to a transcription API)
    // Example: Use MediaRecorder to record audio
    const recorder = new MediaRecorder(combinedStream);
    recorder.ondataavailable = (event) => {
      console.log("Audio data available:", event.data);
      // Send audio data to a transcription API
    };
    recorder.start();
  } catch (error) {
    console.error("Error capturing audio:", error);
  }
}

// Trigger audio capture
captureAudio();
