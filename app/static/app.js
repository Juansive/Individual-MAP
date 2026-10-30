// 页面上的少量交互：拖拽上传、技能快捷添加、删除确认、"至今"开关。

// 拖拽上传：.dropzone 内含一个 file input。
// 多次拖入或多次点选的文件会累加（方便从不同文件夹分批选），每个文件都可以单独移除。
document.querySelectorAll(".dropzone").forEach((zone) => {
  const input = zone.querySelector("input[type=file]");
  const text = zone.querySelector(".dz-text");
  const original = text.textContent;
  const list = document.createElement("ul");
  list.className = "file-list";
  zone.after(list);

  let picked = [];  // 当前已选的全部文件
  const keyOf = (f) => `${f.name}|${f.size}|${f.lastModified}`;

  // 把 picked 写回 input，表单提交时才会带上全部文件
  const syncInput = () => {
    const dt = new DataTransfer();
    picked.forEach((f) => dt.items.add(f));
    input.files = dt.files;
  };

  const render = () => {
    list.innerHTML = "";
    picked.forEach((f, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="fl-name"></span><button type="button" class="link-btn danger" title="移除">✕</button>`;
      li.querySelector(".fl-name").textContent = f.name;
      li.querySelector("button").addEventListener("click", () => {
        picked.splice(i, 1);
        syncInput();
        render();
      });
      list.appendChild(li);
    });
    text.textContent = picked.length ? `已选择 ${picked.length} 个文件，可继续拖入或点击添加` : original;
    zone.classList.toggle("has-files", picked.length > 0);
  };

  const addFiles = (files) => {
    const seen = new Set(picked.map(keyOf));
    for (const f of files) {
      if (!seen.has(keyOf(f))) {
        picked.push(f);
        seen.add(keyOf(f));
      }
    }
    syncInput();
    render();
    if (picked.length && zone.hasAttribute("data-autosubmit")) {
      text.textContent = "正在上传…";
      zone.closest("form").submit();
    }
  };

  // 点选文件时浏览器会用新选择替换 input.files，所以先取出新文件再合并
  input.addEventListener("change", () => addFiles([...input.files]));
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragging"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, () => zone.classList.remove("dragging"))
  );
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });
});

// 点击已有技能，追加到技能输入框
document.querySelectorAll("[data-skill]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.querySelector("input[name=skills]");
    const current = input.value.split(/[,，、;；]/).map((s) => s.trim()).filter(Boolean);
    if (!current.includes(btn.dataset.skill)) current.push(btn.dataset.skill);
    input.value = current.join("、");
  });
});

// 危险操作前确认
document.querySelectorAll("form[data-confirm]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
});

// "至今"勾选后禁用结束时间
const ongoing = document.querySelector("input[name=ongoing]");
if (ongoing) {
  const end = document.querySelector("input[name=end]");
  ongoing.addEventListener("change", () => { end.disabled = ongoing.checked; });
}

// 下拉框决定表单提交地址（详情页"从待归类选择文件"）
document.querySelectorAll("form[data-dynamic-action]").forEach((form) => {
  const select = form.querySelector("[data-action-select]");
  form.addEventListener("submit", (e) => {
    if (!select.value) { e.preventDefault(); return; }
    form.action = select.value;
  });
});
