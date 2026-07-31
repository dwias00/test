(() => {
  "use strict";

  const SESSION_KEY = "cbt_smp_remote_session_v2";
  const CONFIG_KEY = "cbt_smp_remote_config_v2";
  const ATTEMPT_BACKUP_KEY = "cbt_smp_attempt_backup_v2";

  const app = document.getElementById("app");
  const header = document.getElementById("appHeader");
  const headerSubtitle = document.getElementById("headerSubtitle");
  const logoutBtn = document.getElementById("logoutBtn");
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");
  const toastEl = document.getElementById("toast");

  const state = {
    token: null,
    user: null,
    users: [],
    exams: [],
    results: []
  };

  let teacherTab = "exams";
  let examRuntime = null;
  let timerId = null;
  let toastTimer = null;
  let saveAttemptTimer = null;
  let submittingExam = false;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const h = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function getStored(key, fallback = null) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setStored(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getConfig() {
    const fileConfig = window.CBT_CONFIG || {};
    const localConfig = getStored(CONFIG_KEY, {});
    const supabaseUrl = String(localConfig.supabaseUrl || fileConfig.supabaseUrl || "").trim().replace(/\/$/, "");
    const supabaseAnonKey = String(localConfig.supabaseAnonKey || fileConfig.supabaseAnonKey || "").trim();
    const configured = /^https:\/\/.+\.supabase\.co$/i.test(supabaseUrl)
      && supabaseAnonKey.length > 20
      && !supabaseUrl.includes("PASTE_")
      && !supabaseAnonKey.includes("PASTE_");
    return { supabaseUrl, supabaseAnonKey, configured };
  }

  async function rpc(functionName, params = {}, options = {}) {
    const config = getConfig();
    if (!config.configured) throw new Error("Database belum dikonfigurasi.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 25000);
    const headers = {
      "Content-Type": "application/json",
      apikey: config.supabaseAnonKey
    };
    if (/^eyJ[A-Za-z0-9_-]+\./.test(config.supabaseAnonKey)) {
      headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    }
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: controller.signal,
        keepalive: Boolean(options.keepalive)
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      if (!response.ok) {
        const message = payload?.message || payload?.details || payload?.hint || `Permintaan gagal (${response.status}).`;
        throw new Error(message);
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Koneksi ke database terlalu lama. Periksa internet lalu coba lagi.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function toast(message, type = "") {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`.trim();
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 3200);
  }

  function showHeader(subtitle) {
    header.classList.remove("hidden");
    headerSubtitle.textContent = subtitle;
  }

  function hideHeader() {
    header.classList.add("hidden");
  }

  function showModal(content, setup) {
    modalContent.innerHTML = content;
    if (typeof setup === "function") setup(modalContent);
    if (!modal.open) modal.showModal();
  }

  function closeModal() {
    if (modal.open) modal.close();
  }

  function renderLoading(message = "Mengambil data dari database…") {
    app.innerHTML = `<section class="auth-page"><div class="auth-card card center"><div class="loading-spinner" aria-hidden="true"></div><h2>${h(message)}</h2><p class="muted">Pastikan perangkat terhubung ke internet.</p></div></section>`;
  }

  function setButtonBusy(button, busy, busyText = "Menyimpan…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
    }
  }

  function statCard(label, value, note = "") {
    return `<div class="stat-card card"><span>${h(label)}</span><strong>${h(value)}</strong>${note ? `<small class="muted">${h(note)}</small>` : ""}</div>`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function scoreBadge(score, passingScore) {
    return score >= passingScore
      ? `<span class="badge success">Lulus · ${score}</span>`
      : `<span class="badge danger">Belum lulus · ${score}</span>`;
  }

  function friendlyError(error) {
    const text = String(error?.message || error || "Terjadi kesalahan.");
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return "Tidak dapat terhubung ke database. Periksa internet, URL Supabase, dan API key.";
    return text.replace(/^PGRST\d+:?\s*/i, "");
  }

  async function loadBootstrap() {
    if (!state.token) throw new Error("Sesi tidak tersedia.");
    const data = await rpc("app_bootstrap", { p_token: state.token });
    state.user = data.user;
    state.users = Array.isArray(data.users) ? data.users : [];
    state.exams = Array.isArray(data.exams) ? data.exams : [];
    state.results = Array.isArray(data.results) ? data.results : [];
    setStored(SESSION_KEY, { token: state.token });
    return data;
  }

  async function refreshAndRoute(message) {
    renderLoading(message || "Memperbarui data…");
    await loadBootstrap();
    routeUser();
  }

  function renderConfiguration() {
    clearTimer();
    hideHeader();
    const config = getConfig();
    app.innerHTML = `
      <section class="auth-page">
        <div class="auth-card card setup-card">
          <div class="hero-mark">DB</div>
          <h1>Hubungkan Database</h1>
          <p class="muted">Masukkan Project URL dan Publishable/anon key dari proyek Supabase Anda.</p>
          <form id="configForm" class="stack">
            <label>Supabase Project URL<input name="supabaseUrl" type="url" required value="${h(config.supabaseUrl.includes("PASTE_") ? "" : config.supabaseUrl)}" placeholder="https://xxxxxxxx.supabase.co" autocapitalize="none"></label>
            <label>Publishable / anon key<textarea name="supabaseAnonKey" required rows="4" placeholder="sb_publishable_... atau eyJ..." autocapitalize="none">${h(config.supabaseAnonKey.includes("PASTE_") ? "" : config.supabaseAnonKey)}</textarea></label>
            <button class="btn btn-primary btn-block" type="submit">Simpan dan uji koneksi</button>
          </form>
          <div class="card setup-note"><strong>Sebelum langkah ini</strong><p class="muted">Jalankan file <code>database.sql</code> di Supabase SQL Editor. Kunci publishable memang boleh digunakan di frontend; jangan pernah memasukkan service role key.</p></div>
        </div>
      </section>`;

    document.getElementById("configForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const data = new FormData(event.currentTarget);
      const value = {
        supabaseUrl: String(data.get("supabaseUrl") || "").trim().replace(/\/$/, ""),
        supabaseAnonKey: String(data.get("supabaseAnonKey") || "").trim()
      };
      setStored(CONFIG_KEY, value);
      setButtonBusy(button, true, "Menguji…");
      try {
        await rpc("app_login", { p_username: "__connection_test__", p_password: "__connection_test__" });
      } catch (error) {
        const message = friendlyError(error);
        if (/Nama pengguna atau kata sandi salah/i.test(message)) {
          toast("Koneksi database berhasil.");
          renderLogin();
          return;
        }
        toast(message, "error");
      } finally {
        setButtonBusy(button, false);
      }
    });
  }

  function renderLogin() {
    clearTimer();
    examRuntime = null;
    state.user = null;
    state.users = [];
    state.exams = [];
    state.results = [];
    hideHeader();

    if (!getConfig().configured) return renderConfiguration();

    app.innerHTML = document.getElementById("loginTemplate").innerHTML;
    const form = document.getElementById("loginForm");
    const username = document.getElementById("loginUsername");
    const password = document.getElementById("loginPassword");
    const footer = app.querySelector(".auth-card > .tiny.muted.center");
    if (footer) footer.textContent = "Data tersimpan terpusat di database sekolah.";

    const configButton = document.createElement("button");
    configButton.type = "button";
    configButton.className = "btn btn-ghost btn-small config-link";
    configButton.textContent = "⚙ Pengaturan database";
    configButton.addEventListener("click", renderConfiguration);
    app.querySelector(".auth-card")?.appendChild(configButton);

    document.getElementById("togglePassword").addEventListener("click", (event) => {
      password.type = password.type === "password" ? "text" : "password";
      event.currentTarget.textContent = password.type === "password" ? "👁" : "🙈";
    });

    document.querySelectorAll(".demo-login").forEach((button) => {
      button.addEventListener("click", () => {
        username.value = button.dataset.user;
        password.value = button.dataset.pass;
        form.requestSubmit();
      });
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitButton = event.submitter;
      setButtonBusy(submitButton, true, "Memeriksa…");
      try {
        const data = await rpc("app_login", {
          p_username: username.value.trim(),
          p_password: password.value
        });
        state.token = data.token;
        state.user = data.user;
        setStored(SESSION_KEY, { token: state.token });
        await loadBootstrap();
        toast(`Selamat datang, ${state.user.name}.`);
        routeUser();
      } catch (error) {
        toast(friendlyError(error), "error");
      } finally {
        setButtonBusy(submitButton, false);
      }
    });
  }

  async function restoreSession() {
    const session = getStored(SESSION_KEY, null);
    if (!session?.token || !getConfig().configured) return false;
    state.token = session.token;
    try {
      await loadBootstrap();
      return true;
    } catch {
      state.token = null;
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
  }

  function routeUser() {
    if (!state.user) return renderLogin();
    if (state.user.role === "teacher") renderTeacher();
    else renderStudent();
  }

  function renderTeacher() {
    clearTimer();
    showHeader(`Masuk sebagai ${state.user.name}`);
    app.innerHTML = document.getElementById("teacherTemplate").innerHTML;
    document.getElementById("teacherGreeting").textContent = `Halo, ${state.user.name}`;
    document.getElementById("newExamQuickBtn").addEventListener("click", () => openExamEditor());

    const students = state.users.filter((user) => user.role === "student");
    const avg = state.results.length
      ? Math.round(state.results.reduce((sum, result) => sum + Number(result.score || 0), 0) / state.results.length)
      : 0;
    document.getElementById("teacherStats").innerHTML = [
      statCard("Total ujian", state.exams.length, `${state.exams.filter((exam) => exam.active).length} aktif`),
      statCard("Total siswa", students.length),
      statCard("Pengerjaan", state.results.length),
      statCard("Rata-rata nilai", avg)
    ].join("");

    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === teacherTab);
      button.addEventListener("click", () => {
        teacherTab = button.dataset.tab;
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        renderTeacherTab();
      });
    });
    renderTeacherTab();
  }

  function renderTeacherTab() {
    const content = document.getElementById("teacherTabContent");
    if (!content) return;
    if (teacherTab === "exams") renderExamManagement(content);
    if (teacherTab === "students") renderStudentManagement(content);
    if (teacherTab === "results") renderResultManagement(content);
    if (teacherTab === "backup") renderDataManagement(content);
  }

  function renderExamManagement(content) {
    content.innerHTML = `
      <section class="section-block">
        <div class="section-heading">
          <div><p class="eyebrow">Bank ujian terpusat</p><h2>Ujian</h2></div>
          <button id="newExamBtn" class="btn btn-primary">+ Ujian baru</button>
        </div>
        <div class="card-grid" id="teacherExamList">
          ${state.exams.length ? state.exams.map((exam) => `
            <article class="exam-card card">
              <div class="exam-card-header">
                <div><h3>${h(exam.title)}</h3><p class="muted tiny">${h(exam.subject)} · ${h(exam.className || "Semua kelas")}</p></div>
                <span class="badge ${exam.active ? "success" : "warning"}">${exam.active ? "Aktif" : "Nonaktif"}</span>
              </div>
              <div class="meta-row">
                <span>📝 ${(exam.questions || []).length} soal</span><span>⏱ ${exam.durationMinutes} menit</span><span>🎯 KKM ${exam.passingScore}</span>
              </div>
              <div class="actions-row">
                <button class="btn btn-secondary btn-small edit-exam" data-id="${exam.id}">Edit</button>
                <button class="btn btn-ghost btn-small toggle-exam" data-id="${exam.id}">${exam.active ? "Nonaktifkan" : "Aktifkan"}</button>
                <button class="btn btn-ghost btn-small duplicate-exam" data-id="${exam.id}">Duplikat</button>
                <button class="btn btn-ghost btn-small delete-exam" data-id="${exam.id}">Hapus</button>
              </div>
            </article>
          `).join("") : `<div class="empty-state">Belum ada ujian. Buat ujian pertama Anda.</div>`}
        </div>
      </section>`;

    document.getElementById("newExamBtn").addEventListener("click", () => openExamEditor());
    content.querySelectorAll(".edit-exam").forEach((button) => button.addEventListener("click", () => openExamEditor(button.dataset.id)));
    content.querySelectorAll(".toggle-exam").forEach((button) => button.addEventListener("click", () => toggleExam(button)));
    content.querySelectorAll(".duplicate-exam").forEach((button) => button.addEventListener("click", () => duplicateExam(button)));
    content.querySelectorAll(".delete-exam").forEach((button) => button.addEventListener("click", () => deleteExam(button)));
  }

  function blankQuestion() {
    return { id: `new_${crypto.randomUUID?.() || Date.now()}`, text: "", options: ["", "", "", ""], correctIndex: 0 };
  }

  function openExamEditor(examId = null) {
    const source = examId ? state.exams.find((exam) => exam.id === examId) : null;
    const exam = source ? clone(source) : {
      id: null,
      title: "",
      subject: "",
      className: "",
      durationMinutes: 60,
      passingScore: 75,
      active: true,
      randomizeQuestions: true,
      randomizeOptions: true,
      allowRetake: false,
      questions: [blankQuestion()]
    };

    showModal(`
      <h2>${source ? "Edit ujian" : "Buat ujian"}</h2>
      <p class="muted">Perubahan langsung tersimpan di database dan terlihat oleh seluruh perangkat.</p>
      <form id="examEditorForm" class="stack">
        <div class="form-grid">
          <label>Judul ujian<input name="title" required value="${h(exam.title)}" placeholder="Contoh: Ulangan Matematika Bab 1"></label>
          <label>Mata pelajaran<input name="subject" required value="${h(exam.subject)}" placeholder="Matematika"></label>
          <label>Kelas<input name="className" value="${h(exam.className)}" placeholder="Contoh: VIII A atau kosong untuk semua"></label>
          <label>Durasi (menit)<input name="durationMinutes" type="number" min="1" max="300" required value="${exam.durationMinutes}"></label>
          <label>Nilai kelulusan/KKM<input name="passingScore" type="number" min="0" max="100" required value="${exam.passingScore}"></label>
          <div class="stack">
            <label class="checkbox-line"><input name="active" type="checkbox" ${exam.active ? "checked" : ""}> Ujian aktif</label>
            <label class="checkbox-line"><input name="randomizeQuestions" type="checkbox" ${exam.randomizeQuestions ? "checked" : ""}> Acak urutan soal</label>
            <label class="checkbox-line"><input name="randomizeOptions" type="checkbox" ${exam.randomizeOptions ? "checked" : ""}> Acak pilihan jawaban</label>
            <label class="checkbox-line"><input name="allowRetake" type="checkbox" ${exam.allowRetake ? "checked" : ""}> Izinkan mengulang</label>
          </div>
        </div>
        <div class="toolbar">
          <div><strong>Daftar soal</strong><p class="tiny muted">Pilih lingkaran pada jawaban yang benar.</p></div>
          <button id="addQuestionBtn" type="button" class="btn btn-secondary btn-small">+ Tambah soal</button>
        </div>
        <div id="questionEditorList" class="stack"></div>
        <div class="modal-footer">
          <button type="button" id="cancelExamEdit" class="btn btn-secondary">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan ujian</button>
        </div>
      </form>`, () => {
      const list = document.getElementById("questionEditorList");
      (exam.questions || [blankQuestion()]).forEach((question) => appendQuestionEditor(list, question));
      document.getElementById("addQuestionBtn").addEventListener("click", () => appendQuestionEditor(list, blankQuestion()));
      document.getElementById("cancelExamEdit").addEventListener("click", closeModal);
      document.getElementById("examEditorForm").addEventListener("submit", (event) => saveExamFromEditor(event, exam.id));
    });
  }

  function appendQuestionEditor(list, question) {
    const wrapper = document.createElement("div");
    wrapper.className = "question-editor";
    wrapper.dataset.questionId = question.id || `new_${Date.now()}`;
    const options = Array.isArray(question.options) && question.options.length >= 2 ? question.options : ["", "", "", ""];
    while (options.length < 4) options.push("");
    wrapper.innerHTML = `
      <div class="question-editor-head"><strong>Soal <span class="question-order"></span></strong><button type="button" class="btn btn-ghost btn-small remove-question">Hapus</button></div>
      <label>Pertanyaan<textarea class="q-text" required placeholder="Tuliskan pertanyaan">${h(question.text)}</textarea></label>
      <div class="stack">
        ${options.slice(0, 4).map((option, index) => `
          <label class="option-editor">
            <input type="radio" name="correct_${h(wrapper.dataset.questionId)}" value="${index}" ${Number(question.correctIndex) === index ? "checked" : ""} aria-label="Jawaban benar pilihan ${index + 1}">
            <input class="q-option" required value="${h(option)}" placeholder="Pilihan ${String.fromCharCode(65 + index)}">
          </label>`).join("")}
      </div>`;
    wrapper.querySelector(".remove-question").addEventListener("click", () => {
      if (list.children.length <= 1) return toast("Ujian harus memiliki minimal satu soal.", "error");
      wrapper.remove();
      renumberQuestionEditors(list);
    });
    list.appendChild(wrapper);
    renumberQuestionEditors(list);
  }

  function renumberQuestionEditors(list) {
    [...list.children].forEach((element, index) => {
      element.querySelector(".question-order").textContent = index + 1;
    });
  }

  async function saveExamFromEditor(event, examId) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const data = new FormData(form);
    const questions = [...document.querySelectorAll(".question-editor")].map((element) => ({
      text: element.querySelector(".q-text").value.trim(),
      options: [...element.querySelectorAll(".q-option")].map((input) => input.value.trim()),
      correctIndex: Number(element.querySelector('input[type="radio"]:checked')?.value ?? 0)
    }));
    if (questions.some((question) => !question.text || question.options.some((option) => !option))) {
      return toast("Semua pertanyaan dan pilihan harus diisi.", "error");
    }
    const exam = {
      id: examId || null,
      title: String(data.get("title") || "").trim(),
      subject: String(data.get("subject") || "").trim(),
      className: String(data.get("className") || "").trim(),
      durationMinutes: Number(data.get("durationMinutes")),
      passingScore: Number(data.get("passingScore")),
      active: data.has("active"),
      randomizeQuestions: data.has("randomizeQuestions"),
      randomizeOptions: data.has("randomizeOptions"),
      allowRetake: data.has("allowRetake"),
      questions
    };
    setButtonBusy(button, true);
    try {
      await rpc("app_save_exam", { p_token: state.token, p_exam: exam });
      closeModal();
      toast("Ujian berhasil disimpan di database.");
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function toggleExam(button) {
    const exam = state.exams.find((item) => item.id === button.dataset.id);
    if (!exam) return;
    const payload = clone(exam);
    payload.active = !payload.active;
    setButtonBusy(button, true, "Memproses…");
    try {
      await rpc("app_set_exam_active", { p_token: state.token, p_exam_id: payload.id, p_active: payload.active });
      toast(`Ujian ${payload.active ? "diaktifkan" : "dinonaktifkan"}.`);
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
      setButtonBusy(button, false);
    }
  }

  async function duplicateExam(button) {
    const exam = state.exams.find((item) => item.id === button.dataset.id);
    if (!exam) return;
    const copy = clone(exam);
    copy.id = null;
    copy.title = `${copy.title} (Salinan)`;
    copy.active = false;
    copy.questions = copy.questions.map(({ text, options, correctIndex }) => ({ text, options, correctIndex }));
    setButtonBusy(button, true, "Menyalin…");
    try {
      await rpc("app_save_exam", { p_token: state.token, p_exam: copy });
      toast("Ujian berhasil diduplikat.");
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
      setButtonBusy(button, false);
    }
  }

  async function deleteExam(button) {
    const exam = state.exams.find((item) => item.id === button.dataset.id);
    if (!exam || !confirm(`Hapus ujian “${exam.title}”? Hasil lama tetap tersimpan sebagai arsip.`)) return;
    setButtonBusy(button, true, "Menghapus…");
    try {
      await rpc("app_delete_exam", { p_token: state.token, p_exam_id: exam.id });
      toast("Ujian dihapus.");
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
      setButtonBusy(button, false);
    }
  }

  function renderStudentManagement(content) {
    const students = state.users.filter((user) => user.role === "student");
    content.innerHTML = `
      <section class="section-block">
        <div class="section-heading"><div><p class="eyebrow">Peserta terpusat</p><h2>Data Siswa</h2></div><button id="addStudentBtn" class="btn btn-primary">+ Tambah siswa</button></div>
        ${students.length ? `<div class="table-wrap"><table><thead><tr><th>Nama</th><th>Kelas</th><th>Username</th><th>Kata sandi</th><th>Aksi</th></tr></thead><tbody>
          ${students.map((student) => `<tr><td><strong>${h(student.name)}</strong></td><td>${h(student.className || "-")}</td><td>${h(student.username)}</td><td><span class="badge">Tersimpan sebagai hash</span></td><td><button class="btn btn-ghost btn-small edit-student" data-id="${student.id}">Edit</button> <button class="btn btn-ghost btn-small delete-student" data-id="${student.id}">Hapus</button></td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty-state">Belum ada siswa.</div>`}
      </section>`;
    document.getElementById("addStudentBtn").addEventListener("click", () => openStudentEditor());
    content.querySelectorAll(".edit-student").forEach((button) => button.addEventListener("click", () => openStudentEditor(button.dataset.id)));
    content.querySelectorAll(".delete-student").forEach((button) => button.addEventListener("click", () => deleteStudent(button)));
  }

  function openStudentEditor(studentId = null) {
    const student = studentId ? state.users.find((user) => user.id === studentId) : null;
    showModal(`
      <h2>${student ? "Edit siswa" : "Tambah siswa"}</h2>
      <form id="studentEditorForm" class="stack">
        <label>Nama lengkap<input name="name" required value="${h(student?.name || "")}" placeholder="Nama siswa"></label>
        <label>Kelas<input name="className" value="${h(student?.className || "")}" placeholder="VIII A"></label>
        <label>Nama pengguna<input name="username" required value="${h(student?.username || "")}" placeholder="siswa03" autocapitalize="none"></label>
        <label>${student ? "Kata sandi baru (opsional)" : "Kata sandi"}<input name="password" ${student ? "" : "required"} type="password" placeholder="Minimal 4 karakter"></label>
        ${student ? `<p class="tiny muted">Kosongkan kata sandi untuk mempertahankan kata sandi lama.</p>` : ""}
        <div class="modal-footer"><button type="button" id="cancelStudentEdit" class="btn btn-secondary">Batal</button><button class="btn btn-primary" type="submit">Simpan</button></div>
      </form>`, () => {
      document.getElementById("cancelStudentEdit").addEventListener("click", closeModal);
      document.getElementById("studentEditorForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.submitter;
        const data = new FormData(event.currentTarget);
        const password = String(data.get("password") || "");
        if (password && password.length < 4) return toast("Kata sandi minimal 4 karakter.", "error");
        const record = {
          id: studentId || null,
          name: String(data.get("name") || "").trim(),
          className: String(data.get("className") || "").trim(),
          username: String(data.get("username") || "").trim(),
          password
        };
        setButtonBusy(button, true);
        try {
          await rpc("app_save_student", { p_token: state.token, p_student: record });
          closeModal();
          toast("Data siswa disimpan.");
          await refreshAndRoute();
        } catch (error) {
          toast(friendlyError(error), "error");
          setButtonBusy(button, false);
        }
      });
    });
  }

  async function deleteStudent(button) {
    const student = state.users.find((user) => user.id === button.dataset.id);
    if (!student || !confirm(`Hapus akun ${student.name}? Riwayat nilai tetap tersimpan.`)) return;
    setButtonBusy(button, true, "Menghapus…");
    try {
      await rpc("app_delete_student", { p_token: state.token, p_student_id: student.id });
      toast("Akun siswa dihapus.");
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
      setButtonBusy(button, false);
    }
  }

  function renderResultManagement(content) {
    const results = [...state.results].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    content.innerHTML = `
      <section class="section-block">
        <div class="section-heading">
          <div><p class="eyebrow">Rekap terpusat</p><h2>Hasil Ujian</h2></div>
          <div class="toolbar-group"><button id="exportResultsBtn" class="btn btn-secondary btn-small" ${results.length ? "" : "disabled"}>Unduh CSV</button><button id="clearResultsBtn" class="btn btn-ghost btn-small" ${results.length ? "" : "disabled"}>Hapus semua</button></div>
        </div>
        ${results.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Siswa</th><th>Ujian</th><th>Benar</th><th>Nilai</th><th>Status</th><th>Pindah layar</th></tr></thead><tbody>
          ${results.map((result) => {
            const pass = Number(result.score) >= Number(result.passingScore);
            return `<tr><td>${h(formatDate(result.submittedAt))}</td><td><strong>${h(result.studentName || "Siswa terhapus")}</strong><br><small>${h(result.className || "-")}</small></td><td>${h(result.examTitle || "Ujian terhapus")}</td><td>${result.correctCount}/${result.totalQuestions}</td><td><strong>${result.score}</strong></td><td><span class="badge ${pass ? "success" : "danger"}">${pass ? "Lulus" : "Belum"}</span></td><td>${result.focusLosses || 0}</td></tr>`;
          }).join("")}
        </tbody></table></div>` : `<div class="empty-state">Belum ada siswa yang mengumpulkan ujian.</div>`}
      </section>`;
    document.getElementById("exportResultsBtn").addEventListener("click", exportResultsCsv);
    document.getElementById("clearResultsBtn").addEventListener("click", clearResults);
  }

  async function clearResults(event) {
    if (!confirm("Hapus seluruh rekap hasil ujian dari database? Tindakan ini tidak dapat dibatalkan.")) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, "Menghapus…");
    try {
      await rpc("app_clear_results", { p_token: state.token });
      toast("Seluruh rekap hasil dihapus.");
      await refreshAndRoute();
    } catch (error) {
      toast(friendlyError(error), "error");
      setButtonBusy(button, false);
    }
  }

  function exportResultsCsv() {
    const rows = [["Waktu", "Nama", "Kelas", "Ujian", "Benar", "Jumlah Soal", "Nilai", "KKM", "Status", "Pindah Layar"]];
    state.results.forEach((result) => rows.push([
      formatDate(result.submittedAt), result.studentName || "", result.className || "", result.examTitle || "",
      result.correctCount, result.totalQuestions, result.score, result.passingScore,
      Number(result.score) >= Number(result.passingScore) ? "Lulus" : "Belum lulus", result.focusLosses || 0
    ]));
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadBlob(csv, `hasil-cbt-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
  }

  function renderDataManagement(content) {
    const config = getConfig();
    content.innerHTML = `
      <section class="section-block">
        <div class="section-heading"><div><p class="eyebrow">Database</p><h2>Kelola Data</h2></div></div>
        <div class="card-grid">
          <article class="exam-card card"><div><h3>Sinkronkan sekarang</h3><p class="muted">Ambil perubahan terbaru dari database pusat.</p></div><button id="refreshDataBtn" class="btn btn-primary">Muat ulang data</button></article>
          <article class="exam-card card"><div><h3>Ekspor snapshot</h3><p class="muted">Unduh salinan data yang sedang terlihat oleh akun guru.</p></div><button id="exportBackupBtn" class="btn btn-secondary">Unduh JSON</button></article>
          <article class="exam-card card"><div><h3>Konfigurasi koneksi</h3><p class="muted">Project: ${h(config.supabaseUrl.replace("https://", ""))}</p></div><button id="changeConfigBtn" class="btn btn-ghost">Ubah koneksi</button></article>
        </div>
        <div class="card database-status"><strong>✓ Database terpusat aktif</strong><p class="muted">Kata sandi disimpan sebagai hash. Tabel tidak dapat dibaca langsung dengan publishable key; browser hanya dapat memakai fungsi RPC yang memeriksa token dan peran pengguna.</p></div>
      </section>`;
    document.getElementById("refreshDataBtn").addEventListener("click", async (event) => {
      setButtonBusy(event.currentTarget, true, "Memuat…");
      try { await refreshAndRoute(); toast("Data terbaru berhasil dimuat."); }
      catch (error) { toast(friendlyError(error), "error"); setButtonBusy(event.currentTarget, false); }
    });
    document.getElementById("exportBackupBtn").addEventListener("click", exportBackup);
    document.getElementById("changeConfigBtn").addEventListener("click", () => {
      if (!confirm("Mengubah koneksi akan mengeluarkan Anda dari aplikasi. Lanjutkan?")) return;
      localStorage.removeItem(SESSION_KEY);
      state.token = null;
      renderConfiguration();
    });
  }

  function exportBackup() {
    const payload = {
      app: "CBT SMP Central",
      version: 2,
      exportedAt: new Date().toISOString(),
      users: state.users,
      exams: state.exams,
      results: state.results
    };
    downloadBlob(JSON.stringify(payload, null, 2), `snapshot-cbt-smp-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  }

  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderStudent() {
    clearTimer();
    showHeader(`Siswa · ${state.user.className || "Tanpa kelas"}`);
    app.innerHTML = document.getElementById("studentTemplate").innerHTML;
    document.getElementById("studentGreeting").textContent = `Halo, ${state.user.name}`;
    const exams = state.exams.filter((exam) => exam.active);
    const results = [...state.results].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const best = results.length ? Math.max(...results.map((result) => Number(result.score || 0))) : 0;
    document.getElementById("studentStats").innerHTML = [
      statCard("Ujian tersedia", exams.length),
      statCard("Sudah dikerjakan", new Set(results.map((result) => result.examId)).size),
      statCard("Nilai terbaik", best),
      statCard("Total percobaan", results.length)
    ].join("");

    const examList = document.getElementById("availableExamList");
    examList.innerHTML = exams.length ? exams.map((exam) => {
      const attempts = results.filter((result) => result.examId === exam.id);
      const canStart = exam.allowRetake || attempts.length === 0;
      return `<article class="exam-card card">
        <div class="exam-card-header"><div><h3>${h(exam.title)}</h3><p class="muted tiny">${h(exam.subject)}</p></div><span class="badge success">Aktif</span></div>
        <div class="meta-row"><span>📝 ${exam.questionCount || 0} soal</span><span>⏱ ${exam.durationMinutes} menit</span><span>🎯 KKM ${exam.passingScore}</span></div>
        ${attempts.length ? `<p class="tiny muted">Percobaan terakhir: nilai ${attempts[0].score}</p>` : ""}
        <button class="btn ${canStart ? "btn-primary" : "btn-secondary"} start-exam" data-id="${exam.id}" ${canStart ? "" : "disabled"}>${canStart ? (attempts.length ? "Kerjakan lagi" : "Mulai ujian") : "Sudah dikerjakan"}</button>
      </article>`;
    }).join("") : `<div class="empty-state">Belum ada ujian aktif untuk kelas Anda.</div>`;
    examList.querySelectorAll(".start-exam").forEach((button) => button.addEventListener("click", () => prepareExam(button)));

    const resultList = document.getElementById("studentResultList");
    resultList.innerHTML = results.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Ujian</th><th>Benar</th><th>Nilai</th></tr></thead><tbody>${results.map((result) => `<tr><td>${h(formatDate(result.submittedAt))}</td><td>${h(result.examTitle)}</td><td>${result.correctCount}/${result.totalQuestions}</td><td>${scoreBadge(Number(result.score), Number(result.passingScore))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Belum ada riwayat nilai.</div>`;
  }

  function prepareExam(button) {
    const exam = state.exams.find((item) => item.id === button.dataset.id && item.active);
    if (!exam) return toast("Ujian tidak tersedia.", "error");
    showModal(`
      <h2>${h(exam.title)}</h2>
      <p class="muted">${h(exam.subject)} · ${exam.questionCount || 0} soal · ${exam.durationMinutes} menit</p>
      <div class="card exam-instruction">
        <strong>Petunjuk</strong>
        <p class="muted">Jawaban disimpan otomatis ke database. Pengerjaan dapat dilanjutkan dari perangkat lain dengan akun yang sama selama waktu belum habis. Pindah aplikasi/tab akan dicatat.</p>
      </div>
      <div class="modal-footer"><button id="cancelStartExam" class="btn btn-secondary" type="button">Batal</button><button id="confirmStartExam" class="btn btn-primary" type="button">Mulai sekarang</button></div>`, () => {
      document.getElementById("cancelStartExam").addEventListener("click", closeModal);
      document.getElementById("confirmStartExam").addEventListener("click", async (event) => {
        const startButton = event.currentTarget;
        setButtonBusy(startButton, true, "Menyiapkan…");
        try {
          examRuntime = await rpc("app_start_attempt", { p_token: state.token, p_exam_id: exam.id });
          normalizeRuntime();
          backupAttempt();
          closeModal();
          renderExam();
        } catch (error) {
          toast(friendlyError(error), "error");
          setButtonBusy(startButton, false);
        }
      });
    });
  }

  function normalizeRuntime() {
    if (!examRuntime) return;
    examRuntime.questions = Array.isArray(examRuntime.runtimeQuestions) ? examRuntime.runtimeQuestions : [];
    delete examRuntime.runtimeQuestions;
    examRuntime.answers = Array.isArray(examRuntime.answers) ? examRuntime.answers : Array(examRuntime.questions.length).fill(null);
    examRuntime.flagged = Array.isArray(examRuntime.flagged) ? examRuntime.flagged : Array(examRuntime.questions.length).fill(false);
    examRuntime.currentIndex = Math.min(Math.max(Number(examRuntime.currentIndex || 0), 0), Math.max(examRuntime.questions.length - 1, 0));
    examRuntime.focusLosses = Number(examRuntime.focusLosses || 0);
    examRuntime.startAt = Number(examRuntime.startAt);
    examRuntime.endAt = Number(examRuntime.endAt);
  }

  function renderExam() {
    if (!examRuntime) return renderStudent();
    showHeader("Ujian sedang berlangsung · tersimpan online");
    app.innerHTML = document.getElementById("examTemplate").innerHTML;
    document.getElementById("examSubject").textContent = examRuntime.subject;
    document.getElementById("examTitle").textContent = examRuntime.examTitle;
    document.getElementById("examStudent").textContent = `${state.user.name} · ${state.user.className || "-"}`;
    document.getElementById("totalCount").textContent = examRuntime.questions.length;
    document.getElementById("prevQuestionBtn").addEventListener("click", () => moveQuestion(-1));
    document.getElementById("nextQuestionBtn").addEventListener("click", () => moveQuestion(1));
    document.getElementById("flagQuestionBtn").addEventListener("click", toggleFlag);
    document.getElementById("submitExamBtn").addEventListener("click", () => confirmSubmit(false));
    renderQuestion();
    startTimer();
  }

  function renderQuestion() {
    if (!examRuntime?.questions?.length) return;
    const index = examRuntime.currentIndex;
    const question = examRuntime.questions[index];
    document.getElementById("questionPosition").textContent = `Soal ${index + 1} dari ${examRuntime.questions.length}`;
    document.getElementById("questionText").textContent = question.text;
    document.getElementById("answeredCount").textContent = examRuntime.answers.filter((answer) => answer !== null && answer !== undefined).length;
    const flagBtn = document.getElementById("flagQuestionBtn");
    flagBtn.textContent = examRuntime.flagged[index] ? "★ Ditandai" : "☆ Tandai";
    const optionList = document.getElementById("optionList");
    optionList.innerHTML = question.options.map((option, optionIndex) => {
      const selected = Number(examRuntime.answers[index]) === Number(option.originalIndex);
      return `<label class="option-item ${selected ? "selected" : ""}">
        <input type="radio" name="answer" value="${option.originalIndex}" ${selected ? "checked" : ""}>
        <span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span>
        <span>${h(option.text)}</span>
      </label>`;
    }).join("");
    optionList.querySelectorAll(".option-item").forEach((item) => {
      item.addEventListener("click", () => {
        examRuntime.answers[index] = Number(item.querySelector("input").value);
        backupAttempt();
        saveAttemptDebounced();
        renderQuestion();
      });
    });
    document.getElementById("prevQuestionBtn").disabled = index === 0;
    document.getElementById("nextQuestionBtn").textContent = index === examRuntime.questions.length - 1 ? "Kembali ke awal ↻" : "Berikutnya →";
    renderQuestionNumbers();
  }

  function renderQuestionNumbers() {
    const container = document.getElementById("questionNumbers");
    container.innerHTML = examRuntime.questions.map((_, index) => `<button class="number-btn ${examRuntime.answers[index] !== null && examRuntime.answers[index] !== undefined ? "answered" : ""} ${index === examRuntime.currentIndex ? "current" : ""} ${examRuntime.flagged[index] ? "flagged" : ""}" data-index="${index}">${index + 1}</button>`).join("");
    container.querySelectorAll(".number-btn").forEach((button) => button.addEventListener("click", () => {
      examRuntime.currentIndex = Number(button.dataset.index);
      backupAttempt();
      saveAttemptDebounced();
      renderQuestion();
      document.querySelector(".question-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }

  function moveQuestion(delta) {
    let next = examRuntime.currentIndex + delta;
    if (next >= examRuntime.questions.length) next = 0;
    if (next < 0) next = 0;
    examRuntime.currentIndex = next;
    backupAttempt();
    saveAttemptDebounced();
    renderQuestion();
    document.querySelector(".question-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleFlag() {
    examRuntime.flagged[examRuntime.currentIndex] = !examRuntime.flagged[examRuntime.currentIndex];
    backupAttempt();
    saveAttemptDebounced();
    renderQuestion();
  }

  function backupAttempt() {
    if (examRuntime) setStored(ATTEMPT_BACKUP_KEY, examRuntime);
  }

  function clearAttemptBackup() {
    localStorage.removeItem(ATTEMPT_BACKUP_KEY);
  }

  function saveAttemptDebounced() {
    clearTimeout(saveAttemptTimer);
    saveAttemptTimer = setTimeout(() => saveAttemptNow().catch(() => {}), 650);
  }

  async function saveAttemptNow(options = {}) {
    if (!examRuntime || !state.token || submittingExam) return null;
    clearTimeout(saveAttemptTimer);
    const payload = {
      p_token: state.token,
      p_attempt_id: examRuntime.attemptId,
      p_answers: examRuntime.answers,
      p_flagged: examRuntime.flagged,
      p_current_index: examRuntime.currentIndex,
      p_focus_losses: examRuntime.focusLosses
    };
    const response = await rpc("app_save_attempt", payload, options);
    if (response?.expired && response.result) {
      clearTimer();
      showExamResult(response.result, true);
    }
    return response;
  }

  function saveAttemptKeepalive() {
    if (!examRuntime || !state.token) return;
    saveAttemptNow({ keepalive: true, timeout: 8000 }).catch(() => {});
  }

  function startTimer() {
    clearTimer();
    const update = () => {
      if (!examRuntime) return;
      const remaining = Math.max(0, Number(examRuntime.endAt) - Date.now());
      const totalSeconds = Math.ceil(remaining / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const timer = document.getElementById("examTimer");
      if (timer) timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      timer?.closest(".timer-box")?.classList.toggle("urgent", remaining <= 60_000);
      if (remaining <= 0 && !submittingExam) {
        clearTimer();
        submitExam(true);
      }
    };
    update();
    timerId = setInterval(update, 1000);
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function confirmSubmit(timeExpired) {
    const unanswered = examRuntime.answers.filter((answer) => answer === null || answer === undefined).length;
    const message = unanswered ? `Masih ada ${unanswered} soal yang belum dijawab. Tetap kumpulkan?` : "Kumpulkan ujian sekarang?";
    if (timeExpired || confirm(message)) submitExam(timeExpired);
  }

  async function submitExam(timeExpired = false) {
    if (!examRuntime || submittingExam) return;
    submittingExam = true;
    clearTimer();
    const submitButton = document.getElementById("submitExamBtn");
    setButtonBusy(submitButton, true, "Mengirim jawaban…");
    try {
      const result = await rpc("app_submit_attempt", {
        p_token: state.token,
        p_attempt_id: examRuntime.attemptId,
        p_answers: examRuntime.answers,
        p_flagged: examRuntime.flagged,
        p_current_index: examRuntime.currentIndex,
        p_focus_losses: examRuntime.focusLosses,
        p_time_expired: Boolean(timeExpired)
      }, { timeout: 30000 });
      showExamResult(result, timeExpired);
    } catch (error) {
      toast(`${friendlyError(error)} Jawaban lokal masih tersimpan.`, "error");
      submittingExam = false;
      setButtonBusy(submitButton, false);
      startTimer();
    }
  }

  function showExamResult(result, timeExpired = false) {
    const passed = Number(result.score) >= Number(result.passingScore);
    clearTimer();
    clearAttemptBackup();
    examRuntime = null;
    submittingExam = false;
    showModal(`
      <div class="center"><p class="eyebrow">Ujian selesai</p><h2>${h(result.examTitle)}</h2><div class="result-score">${result.score}</div><h3>${passed ? "Selamat, Anda lulus!" : "Tetap semangat dan belajar lagi."}</h3><p class="muted">Jawaban benar ${result.correctCount} dari ${result.totalQuestions}${timeExpired || result.timeExpired ? " · Waktu habis" : ""}</p><p class="tiny muted">Nilai telah tersimpan di database guru.</p></div>
      <div class="modal-footer"><button id="backToDashboardBtn" class="btn btn-primary btn-block" type="button">Kembali ke dashboard</button></div>`, () => document.getElementById("backToDashboardBtn").addEventListener("click", async () => {
      closeModal();
      try { await refreshAndRoute("Memuat nilai terbaru…"); }
      catch (error) { toast(friendlyError(error), "error"); renderStudent(); }
    }));
  }

  function onVisibilityChange() {
    if (document.hidden && examRuntime) {
      examRuntime.focusLosses = Number(examRuntime.focusLosses || 0) + 1;
      backupAttempt();
      saveAttemptKeepalive();
    }
  }

  async function logout() {
    if (examRuntime && !confirm("Ujian masih berlangsung. Jawaban terakhir akan disimpan, lalu Anda keluar. Tetap keluar?")) return;
    if (examRuntime) {
      backupAttempt();
      try { await saveAttemptNow(); } catch { /* local backup remains */ }
    }
    const token = state.token;
    state.token = null;
    state.user = null;
    examRuntime = null;
    clearTimer();
    localStorage.removeItem(SESSION_KEY);
    renderLogin();
    if (token) rpc("app_logout", { p_token: token }, { keepalive: true, timeout: 8000 }).catch(() => {});
  }

  document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
  logoutBtn.addEventListener("click", logout);
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("beforeunload", () => {
    if (examRuntime) {
      backupAttempt();
      saveAttemptKeepalive();
    }
  });
  window.addEventListener("online", () => {
    if (examRuntime) saveAttemptNow().then(() => toast("Jawaban kembali tersinkronisasi.")).catch(() => {});
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  (async () => {
    if (!getConfig().configured) return renderConfiguration();
    renderLoading("Memeriksa sesi…");
    if (await restoreSession()) routeUser();
    else renderLogin();
  })();
})();
