const API_BASE = "http://localhost:3000";

// DEBUG JWT MARKER: This block controls the dev-only token preview panel in the UI.
const isLocalDebugMode =
  ["localhost", "127.0.0.1"].includes(window.location.hostname) ||
  window.location.search.includes("debug=1");

window.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("token")) {
    showDashboard();
  }
});

function authHeader() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token")}`
  };
}

function showMessage(elementId, message, isSuccess = true) {
  const el = document.getElementById(elementId);
  el.className = `message ${isSuccess ? "success" : "error"}`;
  el.textContent = message;
}

function switchAuthTab(event, tabName) {
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tabs .tab-btn").forEach((btn) => btn.classList.remove("active"));
  document.getElementById(tabName).classList.add("active");
  event.currentTarget.classList.add("active");
}

function switchAppTab(event, tabName) {
  document.querySelectorAll(".app-tab-content").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".app-tabs .tab-btn").forEach((btn) => btn.classList.remove("active"));
  document.getElementById(tabName).classList.add("active");
  event.currentTarget.classList.add("active");

  if (tabName === "community") {
    loadFeed();
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const identifier = document.getElementById("loginIdentifier").value;
  const password = document.getElementById("loginPassword").value;

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("loginMessage", data.error || "Login failed", false);
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    showMessage("loginMessage", "Login successful.", true);
    setTimeout(showDashboard, 250);
  } catch (err) {
    showMessage("loginMessage", "Login failed", false);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const email = document.getElementById("regEmail").value;
  const username = document.getElementById("regUsername").value;
  const password = document.getElementById("regPassword").value;

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("registerMessage", data.error || "Registration failed", false);
      return;
    }

    showMessage("registerMessage", "Account created. Check your OTP below.", true);
    
    // Store email for OTP verification
    window.regEmail = email;

    // Display OTP
    const otpDisplay = document.getElementById("regOtpPreview");
    if (otpDisplay) {
      otpDisplay.style.display = data.otp ? "block" : "none";
      otpDisplay.textContent = data.otp
        ? `Test OTP: ${data.otp} (expires ${new Date(data.expires_at).toLocaleTimeString()})`
        : "";
    }

    // Auto-fill OTP if returned
    if (data.otp) {
      const otpInput = document.getElementById("regVerifyOtp");
      if (otpInput) {
        otpInput.value = data.otp;
      }
    }

    // Show step 2
    document.getElementById("regStep1").style.display = "none";
    document.getElementById("regStep2").style.display = "block";
  } catch (err) {
    showMessage("registerMessage", "Registration failed", false);
  }
}

async function handleVerifyRegistrationOtp(event) {
  event.preventDefault();
  const email = window.regEmail;
  const otp = document.getElementById("regVerifyOtp").value;

  if (!email || !otp) {
    showMessage("registerMessage", "Email and OTP required", false);
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/verify-registration-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("registerMessage", data.error || "Verification failed", false);
      return;
    }

    showMessage("registerMessage", "Email verified! Switch to Login tab.", true);
    
    // Reset form
    setTimeout(() => {
      document.getElementById("regEmail").value = "";
      document.getElementById("regUsername").value = "";
      document.getElementById("regPassword").value = "";
      document.getElementById("regVerifyOtp").value = "";
      document.getElementById("regStep1").style.display = "block";
      document.getElementById("regStep2").style.display = "none";
      window.regEmail = null;
    }, 1500);
  } catch (err) {
    showMessage("registerMessage", "Verification failed", false);
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("forgotEmail").value;

  try {
    const response = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("forgotMessage", data.error || "Failed to send OTP", false);
      return;
    }

    const otpText = data.otp ? ` OTP: ${data.otp}` : "";
    showMessage("forgotMessage", `OTP sent.${otpText}`, true);

    const otpDisplay = document.getElementById("otpPreview");
    if (otpDisplay) {
      otpDisplay.style.display = data.otp ? "block" : "none";
      otpDisplay.textContent = data.otp
        ? `Test OTP: ${data.otp} (expires ${new Date(data.expires_at).toLocaleTimeString()})`
        : "";
    }

    if (data.otp) {
      const otpInput = document.getElementById("resetOtp");
      if (otpInput) {
        otpInput.value = data.otp;
      }
    }
    document.getElementById("forgotStep1").style.display = "none";
    document.getElementById("forgotStep2").style.display = "block";
  } catch (err) {
    showMessage("forgotMessage", "Failed to send OTP", false);
  }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const email = document.getElementById("forgotEmail").value;
  const otp = document.getElementById("resetOtp").value;
  const newPassword = document.getElementById("resetNewPassword").value;

  try {
    const response = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp, newPassword })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("forgotMessage", data.error || "Reset failed", false);
      return;
    }

    showMessage("forgotMessage", "Password reset complete.", true);
  } catch (err) {
    showMessage("forgotMessage", "Reset failed", false);
  }
}

function showDashboard() {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  const token = localStorage.getItem("token") || "";
  if (!user) {
    logout();
    return;
  }

  document.getElementById("authSection").style.display = "none";
  document.getElementById("appSection").style.display = "block";
  document
    .querySelectorAll("#authSection input, #authSection button, #authSection textarea, #authSection select")
    .forEach((element) => {
      element.disabled = true;
    });
  document.getElementById("welcomeUsername").textContent = user.username || user.email;

  const tokenDebug = document.getElementById("tokenDebug");
  const tokenPreview = document.getElementById("tokenPreview");
  if (tokenDebug && tokenPreview) {
    if (isLocalDebugMode && token) {
      tokenDebug.style.display = "block";
      tokenPreview.textContent = maskToken(token);
    } else {
      tokenDebug.style.display = "none";
      tokenPreview.textContent = "";
    }
  }

  loadCheckins();
  loadFeed();
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  document.getElementById("authSection").style.display = "block";
  document.getElementById("appSection").style.display = "none";
  document
    .querySelectorAll("#authSection input, #authSection button, #authSection textarea, #authSection select")
    .forEach((element) => {
      element.disabled = false;
    });
}

function maskToken(token) {
  if (!token || token.length < 20) {
    return token;
  }
  return `${token.slice(0, 16)}...${token.slice(-12)}`;
}

async function copyJwtToken() {
  const token = localStorage.getItem("token") || "";
  if (!token) {
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    alert("JWT copied to clipboard");
  } catch (err) {
    alert("Unable to copy token");
  }
}

function parseSymptoms(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function handleCheckin(event) {
  event.preventDefault();

  const symptoms = parseSymptoms(document.getElementById("checkinSymptoms").value);

  const payload = {
    symptoms,
    mood_score: Number.parseInt(document.getElementById("checkinMood").value || "", 10) || null,
    energy_level: Number.parseInt(document.getElementById("checkinEnergy").value || "", 10) || null,
    sleep_hours: Number.parseFloat(document.getElementById("checkinSleep").value || "") || null,
    body_changes: document.getElementById("checkinBodyChanges").value,
    emotions: document.getElementById("checkinEmotions").value,
    notes: document.getElementById("checkinNotes").value
  };

  try {
    const response = await fetch(`${API_BASE}/checkins`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("checkinMessage", data.error || "Failed to save check-in", false);
      return;
    }

    showMessage("checkinMessage", "Check-in saved.", true);
    event.target.reset();
    loadCheckins();

    if (symptoms.length > 0) {
      await loadInsights(symptoms);
    }
  } catch (err) {
    showMessage("checkinMessage", "Failed to save check-in", false);
  }
}

async function loadCheckins() {
  try {
    const response = await fetch(`${API_BASE}/checkins?limit=10`, {
      headers: authHeader()
    });
    const data = await response.json();
    const root = document.getElementById("checkinsList");

    if (!response.ok || data.length === 0) {
      root.innerHTML = '<div class="item">No check-ins yet.</div>';
      return;
    }

    root.innerHTML = data
      .map((item) => {
        const symptomText = Array.isArray(item.symptoms) && item.symptoms.length > 0
          ? item.symptoms.join(", ")
          : "No symptoms listed";
        const emotionText = item.emotions ? `<strong>Felt:</strong> ${escapeHtml(item.emotions)}<br>` : "";
        const bodyText = item.body_changes ? `<strong>Body:</strong> ${escapeHtml(item.body_changes)}<br>` : "";
        const notesText = item.notes ? `<strong>Notes:</strong> ${escapeHtml(item.notes)}<br>` : "";
        
        return `
          <div class="item">
            <strong>${new Date(item.created_at).toLocaleString()}</strong><br>
            Mood: ${item.mood_score ?? "-"}/10 | Energy: ${item.energy_level ?? "-"}/10 | Sleep: ${item.sleep_hours ?? "-"}h<br>
            Symptoms: ${symptomText}<br>
            ${emotionText}
            ${bodyText}
            ${notesText}
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Error loading checkins:", err);
    document.getElementById("checkinsList").innerHTML = '<div class="item">Failed to load check-ins.</div>';
  }
}

async function loadInsights(symptoms) {
  const root = document.getElementById("insights");
  root.innerHTML = '<div class="item">Loading insights...</div>';

  try {
    // Get user's personal stats from checkins
    const checkinsRes = await fetch(`${API_BASE}/checkins?limit=30`, {
      headers: authHeader()
    });
    const checkins = await checkinsRes.json();

    let personalStats = "";
    if (checkinsRes.ok && checkins.length > 0) {
      const moods = checkins.map(c => c.mood_score).filter(m => m);
      const energies = checkins.map(c => c.energy_level).filter(e => e);
      const emotions = checkins
        .map(c => c.emotions)
        .filter(e => e)
        .flatMap(e => e.split(",").map(s => s.trim().toLowerCase()));

      const avgMood = moods.length ? (moods.reduce((a, b) => a + b) / moods.length).toFixed(1) : "-";
      const avgEnergy = energies.length ? (energies.reduce((a, b) => a + b) / energies.length).toFixed(1) : "-";

      // Count most common emotions
      const emotionCounts = {};
      emotions.forEach(e => {
        if (e) emotionCounts[e] = (emotionCounts[e] || 0) + 1;
      });
      const topEmotions = Object.entries(emotionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([emotion, count]) => `${emotion} (${count}x)`)
        .join(", ");

      personalStats = `
        <div class="item"><strong>Your Recent Patterns</strong><br>
        Avg Mood: ${avgMood}/10 | Avg Energy: ${avgEnergy}/10<br>
        Most felt: ${topEmotions || "No emotions logged"}</div>
      `;
    }

    // Get cohort insights
    const response = await fetch(`${API_BASE}/symptoms/women-like-me`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ symptoms })
    });
    const data = await response.json();

    if (!response.ok) {
      root.innerHTML = personalStats + `<div class="item">${data.error || "Failed to load cohort insights."}</div>`;
      return;
    }

    const topSymptoms = (data.top_symptoms || []).slice(0, 5)
      .map((s) => `${s.canonical_symptom} (${s.count})`)
      .join("<br>");
    const topTreatments = (data.top_treatments || []).slice(0, 5)
      .map((t) => `${t.canonical_treatment} (${t.count})`)
      .join("<br>");

    root.innerHTML = personalStats + `
      <div class="item"><strong>Women Like You (${data.similar_users} found)</strong><br>
      Your symptoms: ${(data.input_symptoms || []).join(", ")}</div>
      <div class="item"><strong>They Also Have</strong><br>${topSymptoms || "No data"}</div>
      <div class="item"><strong>What Helped Them</strong><br>${topTreatments || "No data"}</div>
    `;
  } catch (err) {
    console.error("Error loading insights:", err);
    root.innerHTML = '<div class="item">Failed to load insights.</div>';
  }
}

async function handleCreatePost(event) {
  event.preventDefault();
  const content = document.getElementById("postContent").value.trim();
  const image_url = document.getElementById("postImageUrl").value.trim();

  try {
    const response = await fetch(`${API_BASE}/community/posts`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ content, image_url: image_url || null })
    });
    const data = await response.json();

    if (!response.ok) {
      showMessage("postMessage", data.error || "Failed to create post", false);
      return;
    }

    showMessage("postMessage", "Posted to community.", true);
    event.target.reset();
    loadFeed();
  } catch (err) {
    showMessage("postMessage", "Failed to create post", false);
  }
}

async function loadFeed() {
  const feed = document.getElementById("feedList");
  feed.innerHTML = '<div class="item">Loading posts...</div>';

  try {
    const response = await fetch(`${API_BASE}/community/posts?limit=20`, {
      headers: authHeader()
    });
    const data = await response.json();

    if (!response.ok) {
      feed.innerHTML = '<div class="item">Failed to load posts.</div>';
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      feed.innerHTML = '<div class="item">No posts yet. Be the first to share.</div>';
      return;
    }

    feed.innerHTML = data
      .map((post) => `
        <article class="post" id="post-${post.post_id}">
          <div class="post-top">@${post.username} • ${new Date(post.created_at).toLocaleString()}</div>
          <div class="post-content">${escapeHtml(post.content)}</div>
          ${post.image_url ? `<div class="post-content"><a href="${escapeHtml(post.image_url)}" target="_blank">View image</a></div>` : ""}
          <div class="actions">
            <button class="mini-btn" type="button" onclick="toggleLike(${post.post_id})">${post.current_user_liked ? "Unlike" : "Like"} (${post.likes_count})</button>
            <button class="mini-btn" type="button" onclick="loadComments(${post.post_id})">Comments (${post.comments_count})</button>
          </div>
          <div class="comments" id="comments-${post.post_id}"></div>
        </article>
      `)
      .join("");
  } catch (err) {
    feed.innerHTML = '<div class="item">Failed to load posts.</div>';
  }
}

async function toggleLike(postId) {
  try {
    const response = await fetch(`${API_BASE}/community/posts/${postId}/like`, {
      method: "POST",
      headers: authHeader()
    });
    if (response.ok) {
      loadFeed();
    }
  } catch (err) {
    // no-op
  }
}

async function loadComments(postId) {
  const container = document.getElementById(`comments-${postId}`);
  container.innerHTML = "Loading comments...";

  try {
    const response = await fetch(`${API_BASE}/community/posts/${postId}/comments`, {
      headers: authHeader()
    });
    
    if (!response.ok) {
      console.error(`[Comments] Failed to load comments for post ${postId}: ${response.status}`);
      container.innerHTML = `<div class="item">Failed to load comments (${response.status}).</div>`;
      return;
    }

    const comments = await response.json();
    console.log(`[Comments] Loaded ${comments.length} comments for post ${postId}`);

    const commentsHtml = comments.length
      ? comments.map((c) => `<div class="item"><strong>@${escapeHtml(c.username)}</strong>: ${escapeHtml(c.content)}</div>`).join("")
      : '<div class="item">No comments yet.</div>';

    container.innerHTML = `
      ${commentsHtml}
      <div id="comment-form-${postId}" style="margin-top:8px;">
        <input id="comment-input-${postId}" placeholder="Write a comment" required>
        <button id="comment-btn-${postId}" class="mini-btn" style="margin-top:6px;" type="button">Post Comment</button>
        <div id="comment-status-${postId}" style="margin-top:6px;font-size:12px;color:#6b5a52;"></div>
      </div>
    `;

    const commentInput = document.getElementById(`comment-input-${postId}`);
    const commentButton = document.getElementById(`comment-btn-${postId}`);

    if (commentInput) {
      commentInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          createComment(event, postId);
        }
      });
    }

    if (commentButton) {
      commentButton.addEventListener("click", (event) => {
        event.preventDefault();
        createComment(event, postId);
      });
    }
    console.log(`[Comments] Form rendered for post ${postId}`);
  } catch (err) {
    console.error("[Comments] Exception loading comments:", err);
    container.innerHTML = "Failed to load comments.";
  }
}

async function createComment(event, postId) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const input = document.getElementById(`comment-input-${postId}`);
  const button = document.getElementById(`comment-btn-${postId}`);
  const status = document.getElementById(`comment-status-${postId}`);

  if (!input) {
    console.error(`[Comment] Input element not found for post ${postId}`);
    return false;
  }

  const content = input.value.trim();
  if (!content) {
    if (status) {
      status.textContent = "Type a comment first.";
    }
    return false;
  }

  if (status) {
    status.textContent = "Posting comment...";
  }
  if (button) {
    button.disabled = true;
    button.textContent = "Posting...";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(`${API_BASE}/community/posts/${postId}/comments`, {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ content }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data.error || `Failed (${response.status})`;
      if (status) {
        status.textContent = errorMsg;
      }
      return false;
    }

    input.value = "";
    if (status) {
      status.textContent = "Posted.";
    }
    await loadComments(postId);
    await loadFeed();
  } catch (err) {
    if (status) {
      status.textContent = err.name === "AbortError"
        ? "Request timed out. Try again."
        : "Network error while posting comment.";
    }
    console.error("[Comment] Exception:", err);
  } finally {
    clearTimeout(timeoutId);
    if (button) {
      button.disabled = false;
      button.textContent = "Post Comment";
    }
  }

  return false;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
