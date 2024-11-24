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
