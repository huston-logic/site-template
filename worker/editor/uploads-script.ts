// The script behind the owner page's upload form, served at /owner/uploads.js. Progressive enhancement: without it the
// plain form posts every chosen file in one request. Plain ES2020, no libraries, no inline handlers; names from the
// server go in through textContent and setAttribute, never as HTML. Keep this file free of backticks and dollar-brace.

export const UPLOADS_SCRIPT = String.raw`"use strict";
(function () {
  var form = document.getElementById("upload-form");
  var input = document.getElementById("upload-files");
  var grid = document.getElementById("upload-grid");
  var rows = document.getElementById("upload-progress");
  var live = document.getElementById("upload-status");
  if (!form || !input || !grid || !rows || !live || !window.XMLHttpRequest || !window.FormData) return;
  var button = form.querySelector("button[type=submit]");
  var DAY = 86400000;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function size(bytes) {
    if (bytes < 1000000) return Math.max(1, Math.round(bytes / 1000)) + " KB";
    return Math.round(bytes / 100000) / 10 + " MB";
  }

  function plural(count, word) {
    return count + " " + word + (count === 1 ? "" : "s");
  }

  function card(upload) {
    var item = el("li", "card up");
    if (upload.kind === "photo") {
      var thumb = el("div", "thumb");
      var img = document.createElement("img");
      img.setAttribute("src", "/owner/uploads/" + upload.id + "/preview");
      img.setAttribute("alt", upload.name);
      img.setAttribute("width", "480");
      img.setAttribute("height", "360");
      img.setAttribute("loading", "lazy");
      thumb.appendChild(img);
      item.appendChild(thumb);
    } else {
      var tile = el("div", "thumb doc");
      tile.appendChild(el("span", "", "PDF"));
      item.appendChild(tile);
    }
    item.appendChild(el("h3", "", upload.name));
    var facts = (upload.kind === "photo" ? "Photo" : "PDF") + ", " + size(upload.bytes);
    if (upload.kind === "pdf" && upload.pages) facts += ", " + plural(upload.pages, "page");
    item.appendChild(el("p", "muted", facts));
    var days = Math.max(1, Math.ceil((Date.parse(upload.expiresAt) - Date.now()) / DAY));
    item.appendChild(el("p", "muted", "Removed in " + plural(days, "day")));

    var rename = el("form", "rename");
    rename.setAttribute("method", "post");
    rename.setAttribute("action", "/owner/uploads/rename");
    var hidden = document.createElement("input");
    hidden.setAttribute("type", "hidden");
    hidden.setAttribute("name", "id");
    hidden.setAttribute("value", upload.id);
    var label = el("label", "", "Name");
    label.setAttribute("for", "rename-" + upload.id);
    label.appendChild(el("span", "sr", " of " + upload.name));
    var text = document.createElement("input");
    text.setAttribute("type", "text");
    text.setAttribute("id", "rename-" + upload.id);
    text.setAttribute("name", "name");
    text.setAttribute("value", upload.name);
    text.setAttribute("maxlength", "80");
    text.setAttribute("autocomplete", "off");
    var save = el("button", "btn", "Rename");
    save.setAttribute("type", "submit");
    save.setAttribute("aria-label", "Rename " + upload.name);
    rename.appendChild(hidden);
    rename.appendChild(label);
    rename.appendChild(text);
    rename.appendChild(save);
    item.appendChild(rename);

    var remove = el("a", "btn", "Remove");
    remove.setAttribute("href", "/owner/uploads/remove?upload=" + encodeURIComponent(upload.id));
    remove.setAttribute("aria-label", "Remove: " + upload.name);
    item.appendChild(remove);
    return item;
  }

  function addCard(upload) {
    var empty = document.getElementById("upload-empty");
    if (empty) empty.remove();
    grid.hidden = false;
    grid.insertBefore(card(upload), grid.firstChild);
  }

  function send(file, row, finish) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", form.getAttribute("action") || "/owner/uploads");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        row.bar.max = event.total;
        row.bar.value = event.loaded;
      }
    };
    xhr.onload = function () {
      var data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (error) {
        data = null;
      }
      if (data && data.ok && data.upload) {
        row.bar.max = 1;
        row.bar.value = 1;
        row.status.textContent = "Uploaded.";
        addCard(data.upload);
        finish(true);
      } else {
        row.status.textContent = data && data.message ? data.message : "That file didn't upload. Try again.";
        finish(false);
      }
    };
    xhr.onerror = function () {
      row.status.textContent = "The connection dropped. Try this file again.";
      finish(false);
    };
    var body = new FormData();
    body.append("file", file, file.name);
    xhr.send(body);
  }

  form.addEventListener("submit", function (event) {
    var files = Array.prototype.slice.call(input.files || []);
    if (files.length === 0) return;
    event.preventDefault();
    if (button) button.disabled = true;
    rows.textContent = "";
    live.textContent = "";
    var done = 0;
    var ok = 0;
    var list = el("ul", "plain");
    list.setAttribute("role", "list");
    rows.appendChild(list);
    var entries = files.map(function (file) {
      var item = el("li", "progress-row");
      item.appendChild(el("span", "progress-name", file.name));
      var bar = document.createElement("progress");
      bar.setAttribute("max", "1");
      bar.setAttribute("value", "0");
      bar.setAttribute("aria-label", "Upload progress for " + file.name);
      var status = el("span", "muted", "Waiting");
      item.appendChild(bar);
      item.appendChild(status);
      list.appendChild(item);
      return { file: file, bar: bar, status: status };
    });
    function next() {
      if (done === entries.length) {
        input.value = "";
        if (button) button.disabled = false;
        return;
      }
      var entry = entries[done];
      entry.status.textContent = "Uploading";
      send(entry.file, entry, function (success) {
        done += 1;
        if (success) ok += 1;
        live.textContent = ok + " of " + entries.length + " uploaded" + (done === entries.length && ok < entries.length ? ". Some files need another look." : "");
        next();
      });
    }
    next();
  });
})();
`;
