// ── Bouncing Ball Setup ──
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

let x = 100;
let y = 100;
let dx = 4;
let dy = 4;
const radius = 20;

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "red";
  ctx.fill();

  if (x + radius > canvas.width || x - radius < 0) {
    dx = -dx;
  }
  if (y + radius > canvas.height || y - radius < 0) {
    dy = -dy;
  }

  x += dx;
  y += dy;

  requestAnimationFrame(animate);
}

animate();

// ── User Identity Setup via prompt() ──
let currentUserName = "";

function setupUser() {
  let name = prompt("Please enter your name:");
  while (!name || !name.trim()) {
    name = prompt("A name is required to create and move your pictures. Please enter your name:");
  }
  currentUserName = name.trim();
  const displayEl = document.getElementById("user-name-display");
  if (displayEl) displayEl.textContent = currentUserName;
}

document.getElementById("change-name-btn").addEventListener("click", () => {
  const newName = prompt("Enter new name:", currentUserName);
  if (newName && newName.trim()) {
    currentUserName = newName.trim();
    document.getElementById("user-name-display").textContent = currentUserName;
    refreshOwnership();
  }
});

function refreshOwnership() {
  pictureElements.forEach((img) => {
    const creator = img.dataset.creatorName || "";
    const isOwner = creator && (creator.toLowerCase() === currentUserName.toLowerCase());
    if (isOwner) {
      img.classList.remove("not-owner");
      img.classList.add("is-owner");
      img.title = `Created by you (${creator}) • Click & drag to move`;
      makeDraggable(img);
    } else {
      img.classList.remove("is-owner");
      img.classList.add("not-owner");
      img.title = `Created by ${creator || "someone else"} • (View only)`;
    }
  });
}

// ── Replicate Proxy & Nano Banana 2 API ──
const promptInput = document.getElementById("prompt-input");
const submitBtn = document.getElementById("submit-btn");
const statusDiv = document.getElementById("status");

// Store references to all image elements on screen by docId
const pictureElements = new Map();
let pictureCount = 0;
let highestZIndex = 10;

// Updates the position of a picture when moved by a remote user
function updateRemotePosition(img, xRatio, yRatio, fallbackX, fallbackY) {
  let left, top;
  if (typeof xRatio === "number" && typeof yRatio === "number") {
    left = Math.round(xRatio * window.innerWidth);
    top = Math.round(yRatio * window.innerHeight);
  } else if (typeof fallbackX === "number" && typeof fallbackY === "number") {
    left = fallbackX;
    top = fallbackY;
  }

  if (left !== undefined && top !== undefined) {
    img.style.left = `${left}px`;
    img.style.top = `${top}px`;
  }
}

// Display a picture on screen and configure ownership/dragging
function displayPicture(imageUrl, promptText, docId, isNew = false, xRatio, yRatio, savedX, savedY, creatorName) {
  if (docId && pictureElements.has(docId)) {
    return pictureElements.get(docId);
  }

  const layer = document.getElementById("pictures-layer");
  const img = document.createElement("img");
  img.src = imageUrl;
  img.alt = promptText || "Generated picture";
  img.className = "draggable-image";

  if (docId) {
    img.dataset.docId = docId;
    img.dataset.creatorName = creatorName || "";
    pictureElements.set(docId, img);
  }

  // Check if current user is the owner
  const isOwner = creatorName && (creatorName.toLowerCase() === currentUserName.toLowerCase());
  if (isOwner) {
    img.classList.add("is-owner");
    img.title = `"${promptText}" — Created by you (${creatorName}) • Click & drag to move`;
    makeDraggable(img);
  } else {
    img.classList.add("not-owner");
    img.title = `"${promptText}" — Created by ${creatorName || "someone else"} • (View only)`;
  }

  const padding = 40;
  const imgWidth = 240;
  const maxW = Math.max(imgWidth, window.innerWidth - imgWidth - padding);
  const maxH = Math.max(imgWidth, window.innerHeight - imgWidth - padding);

  let posX, posY;

  // Use saved positions if available
  if (typeof xRatio === "number" && typeof yRatio === "number") {
    posX = Math.round(xRatio * window.innerWidth);
    posY = Math.round(yRatio * window.innerHeight);
  } else if (typeof savedX === "number" && typeof savedY === "number") {
    posX = savedX;
    posY = savedY;
  } else if (isNew) {
    const ui = document.getElementById("ui-container").getBoundingClientRect();
    posX = Math.min(maxW, Math.max(padding, ui.left + (Math.random() * 80 - 40)));
    posY = Math.min(maxH, ui.bottom + 20);
  } else {
    // Scatter / stagger across screen
    const cols = Math.max(1, Math.floor((window.innerWidth - 60) / (imgWidth + 24)));
    const col = pictureCount % cols;
    const row = Math.floor(pictureCount / cols);
    posX = padding + col * (imgWidth + 24) + (pictureCount % 2 ? 15 : 0);
    posY = Math.min(maxH, 220 + (row * (imgWidth + 20)) % Math.max(200, window.innerHeight - 300));
    pictureCount++;
  }

  img.style.left = `${posX}px`;
  img.style.top = `${posY}px`;

  layer.appendChild(img);
  return img;
}

// Throttled position updater to Firestore
const THROTTLE_MS = 60; // Max ~16 database writes/sec during drag
function sendPositionUpdate(docId, left, top) {
  if (!docId || typeof db === "undefined") return;

  const xRatio = left / window.innerWidth;
  const yRatio = top / window.innerHeight;

  db.collection("pictures").doc(docId).update({
    x: left,
    y: top,
    xRatio: xRatio,
    yRatio: yRatio,
    lastMovedBy: currentUserName,
    lastMovedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => {
    console.warn("Failed to sync move to database:", err.message);
  });
}

// Load and listen to pictures in Firestore
function initPictureSync() {
  if (typeof db === "undefined") {
    console.warn("Firestore not available");
    return;
  }

  statusDiv.textContent = "Loading existing pictures...";

  db.collection("pictures").onSnapshot((snapshot) => {
    if (statusDiv.textContent === "Loading existing pictures...") {
      statusDiv.textContent = snapshot.empty ? "No pictures yet. Enter a prompt below!" : `Loaded ${snapshot.size} picture(s) from database.`;
    }

    snapshot.docChanges().forEach((change) => {
      const docId = change.doc.id;
      const data = change.doc.data();

      if (change.type === "added") {
        if (data.imageUrl) {
          displayPicture(
            data.imageUrl,
            data.prompt,
            docId,
            false,
            data.xRatio,
            data.yRatio,
            data.x,
            data.y,
            data.creatorName
          );
        }
      } else if (change.type === "modified") {
        const img = pictureElements.get(docId);
        // Only update position if the local user is NOT actively dragging this image
        if (img && img.dataset.isDragging !== "true") {
          updateRemotePosition(img, data.xRatio, data.yRatio, data.x, data.y);
        }
      } else if (change.type === "removed") {
        const img = pictureElements.get(docId);
        if (img) {
          img.remove();
          pictureElements.delete(docId);
        }
      }
    });
  }, (err) => {
    console.error("Error syncing pictures collection:", err);
    statusDiv.textContent = "Error syncing pictures from database: " + err.message;
  });
}

async function generateImage() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    statusDiv.textContent = "Please enter a prompt first.";
    return;
  }

  submitBtn.disabled = true;
  statusDiv.textContent = `Sending prompt for ${currentUserName} to Nano Banana 2...`;

  const replicateProxy = "https://itp-ima-replicate-proxy.web.app/api/create_n_get";

  const data = {
    model: "google/nano-banana-2",
    input: {
      prompt: prompt,
      aspect_ratio: "1:1",
    },
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  try {
    const response = await fetch(replicateProxy, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(data),
    });

    const result = await response.json();
    console.log("Proxy response:", result);

    if (!response.ok) {
      statusDiv.textContent = `Error: ${result.error || result.details || "Request failed"}`;
      submitBtn.disabled = false;
      return;
    }

    let imageUrl = null;
    if (result.output) {
      imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
    }

    if (imageUrl) {
      statusDiv.textContent = "Image generated! Saving to database...";

      // Calculate initial spawn position
      const ui = document.getElementById("ui-container").getBoundingClientRect();
      const initX = Math.min(window.innerWidth - 280, Math.max(40, ui.left + (Math.random() * 80 - 40)));
      const initY = Math.min(window.innerHeight - 280, ui.bottom + 20);

      try {
        if (typeof db !== "undefined") {
          const docRef = await db.collection("pictures").add({
            prompt: prompt,
            imageUrl: imageUrl,
            creatorName: currentUserName,
            x: initX,
            y: initY,
            xRatio: initX / window.innerWidth,
            yRatio: initY / window.innerHeight,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdLocal: new Date().toISOString(),
          });
          console.log("Saved picture to Firestore with ID:", docRef.id);
          displayPicture(
            imageUrl,
            prompt,
            docRef.id,
            true,
            initX / window.innerWidth,
            initY / window.innerHeight,
            initX,
            initY,
            currentUserName
          );
          statusDiv.textContent = "Image generated and saved! (Only you can move it)";
        } else {
          displayPicture(imageUrl, prompt, null, true, null, null, null, null, currentUserName);
        }
      } catch (dbErr) {
        console.error("Error saving to database:", dbErr);
        displayPicture(imageUrl, prompt, null, true, null, null, null, null, currentUserName);
        statusDiv.textContent = "Image generated, but failed to save to database: " + dbErr.message;
      }
    } else {
      statusDiv.textContent = "No image returned. Response: " + JSON.stringify(result);
    }
  } catch (err) {
    console.error("Fetch error:", err);
    statusDiv.textContent = "Network or fetch error: " + err.message;
  } finally {
    submitBtn.disabled = false;
  }
}

submitBtn.addEventListener("click", generateImage);
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    generateImage();
  }
});

// ── Drag & Drop functionality with Owner-Only Permission ──
function makeDraggable(element) {
  if (element._hasDraggable) return;
  element._hasDraggable = true;

  let isDragging = false;
  let startX, startY;
  let initialLeft, initialTop;
  let lastUpdateTime = 0;

  element.addEventListener("pointerdown", (e) => {
    // Only the creator can drag this picture
    if (!element.classList.contains("is-owner")) return;

    isDragging = true;
    element.dataset.isDragging = "true";
    element.classList.add("dragging");
    element.style.zIndex = ++highestZIndex;
    element.setPointerCapture(e.pointerId);

    const rect = element.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    element.style.position = "fixed";
    element.style.left = `${initialLeft}px`;
    element.style.top = `${initialTop}px`;
    element.style.margin = "0";

    e.preventDefault();
  });

  element.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newLeft = initialLeft + dx;
    const newTop = initialTop + dy;

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;

    // Throttled sync to Firestore while actively dragging
    const now = Date.now();
    if (now - lastUpdateTime > THROTTLE_MS) {
      lastUpdateTime = now;
      sendPositionUpdate(element.dataset.docId, newLeft, newTop);
    }
  });

  const stopDrag = (e) => {
    if (isDragging) {
      isDragging = false;
      element.dataset.isDragging = "false";
      element.classList.remove("dragging");
      try {
        element.releasePointerCapture(e.pointerId);
      } catch (err) {}

      // Send final position update to ensure exact alignment across machines
      const rect = element.getBoundingClientRect();
      sendPositionUpdate(element.dataset.docId, rect.left, rect.top);
    }
  };

  element.addEventListener("pointerup", stopDrag);
  element.addEventListener("pointercancel", stopDrag);
  element.addEventListener("dragstart", (e) => e.preventDefault());
}

// 1. Ask for user name on start
setupUser();

// 2. Start syncing pictures from Firestore
initPictureSync();
