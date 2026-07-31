# CBT Sekolah — Versi Siap Pakai

Aplikasi CBT berbasis web/PWA untuk HP Android dan komputer. Data guru, siswa, ujian, jawaban, dan nilai tersimpan terpusat di Supabase.

Versi ini **tidak memiliki akun, siswa, ujian, atau kata sandi demo**. Setelah pemasangan, halaman pertama akan meminta Anda membuat identitas sekolah dan akun administrator.

## Fitur operasional

- Wizard konfigurasi pertama: nama sekolah, tahun ajaran, semester, dan administrator
- Login guru dan siswa dengan kata sandi yang disimpan sebagai hash bcrypt
- Database terpusat untuk seluruh perangkat
- Pembuatan dan pengacakan soal pilihan ganda
- Timer berbasis waktu database dan autosave jawaban
- Pengerjaan dapat dilanjutkan dari perangkat lain selama waktu belum habis
- Penilaian dilakukan di database, bukan di browser siswa
- Pengelolaan siswa satu per satu atau impor hingga 1.000 siswa melalui CSV
- Rekap hasil, ekspor CSV, dan snapshot JSON
- Pengaturan apakah nilai serta riwayat ditampilkan kepada siswa
- Penggantian kata sandi dari aplikasi
- PWA yang dapat dipasang ke layar utama Android

## 1. Menyiapkan database Supabase

### Instalasi baru — disarankan

1. Buat project Supabase baru.
2. Buka **SQL Editor**.
3. Salin seluruh isi `database.sql` dan tekan **Run**.
4. Pastikan proses selesai tanpa error.

### Bila project lama masih berisi data demo v2

File `RESET-DATABASE.sql` menghapus **semua data CBT** dari project tersebut.

1. Pastikan belum ada data nyata yang perlu disimpan.
2. Jalankan `RESET-DATABASE.sql`.
3. Setelah selesai, jalankan `database.sql`.

Bila project lama sudah berisi data nyata, jangan menjalankan reset. Gunakan project Supabase baru agar data lama tetap aman.

## 2. Mengisi koneksi database

Di Supabase, salin:

- **Project URL**
- **Publishable key** atau legacy **anon key**

Edit `config.js`:

```javascript
window.CBT_CONFIG = {
  supabaseUrl: "https://PROJECT-ANDA.supabase.co",
  supabaseAnonKey: "sb_publishable_..."
};
```

Jangan pernah memasukkan `service_role`, secret key, atau password database ke repository GitHub.

## 3. Mengunggah ke GitHub Pages

Unggah **isi folder ini** ke root repository. `index.html` harus terlihat langsung di halaman utama repository.

Susunannya:

```text
index.html
app.js
app.css
config.js
manifest.webmanifest
sw.js
icons/
```

Kemudian buka:

```text
Repository → Settings → Pages
```

Atur:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

Link aplikasi akan berbentuk:

```text
https://USERNAME.github.io/NAMA-REPOSITORY/
```

## 4. Konfigurasi pertama

Saat link aplikasi dibuka pertama kali, isi:

- Nama sekolah
- Nama aplikasi
- Tahun ajaran dan semester
- Nama administrator
- Username administrator
- Kata sandi administrator minimal 8 karakter

Simpan username dan kata sandi administrator di tempat aman. Wizard ini hanya dapat digunakan sebelum akun administrator pertama dibuat.

## 5. Menambahkan siswa

### Satu per satu

Masuk sebagai administrator, lalu buka:

```text
Siswa → Tambah siswa
```

### Impor CSV

Buka:

```text
Siswa → Template CSV
```

Isi file dengan header berikut:

```csv
username,password,name,className
siswa001,SandiAman01,Nama Siswa,VIII A
siswa002,SandiAman02,Nama Siswa,VIII A
```

Kemudian pilih **Impor CSV**. Username yang sudah ada akan diperbarui. Untuk akun lama, kolom password boleh dikosongkan agar kata sandinya tidak berubah.

## 6. Membuat ujian

1. Buka menu **Ujian**.
2. Tekan **Ujian baru**.
3. Isi judul, mata pelajaran, kelas, durasi, KKM, dan soal.
4. Pastikan jawaban benar dipilih.
5. Aktifkan ujian saat siap digunakan.

Kelas siswa dan kelas ujian harus ditulis konsisten, misalnya `VIII A`. Kolom kelas ujian dapat dikosongkan agar tersedia untuk seluruh kelas.

## 7. Pengujian sebelum digunakan

Lakukan pengujian berikut sebelum ujian nyata:

1. Buat satu akun siswa uji.
2. Buat ujian berisi 3–5 soal.
3. Login dari HP berbeda.
4. Jawab sebagian soal, tutup aplikasi, lalu buka kembali.
5. Pastikan jawaban dapat dilanjutkan.
6. Kumpulkan ujian dan periksa hasil pada dashboard guru.
7. Uji beberapa HP secara bersamaan dengan jaringan yang akan dipakai.

## Pengaturan nilai siswa

Pada menu **Pengaturan**, administrator dapat memilih:

- Menampilkan atau menyembunyikan nilai setelah ujian
- Menampilkan atau menyembunyikan riwayat ujian siswa

Nilai tetap tersedia untuk guru meskipun disembunyikan dari siswa.

## Backup

- Unduh hasil CSV setelah setiap ujian penting.
- Unduh snapshot JSON secara berkala dari menu **Data**.
- Simpan salinan bank soal di tempat lain.
- Paket Free Supabase tidak boleh dianggap sebagai satu-satunya backup sekolah.

## Keamanan penting

- Gunakan kata sandi administrator yang unik dan kuat.
- Jangan gunakan akun administrator pada perangkat siswa.
- Selalu logout dari perangkat bersama.
- Publishable/anon key boleh berada di frontend; keamanan data bergantung pada RLS dan fungsi RPC di `database.sql`.
- Jangan menonaktifkan RLS atau memberi akses langsung ke tabel untuk role `anon`.
- Sesi berlaku 12 jam dan diperpanjang selama aplikasi aktif.
- Aplikasi mencatat perpindahan tab/aplikasi, tetapi tidak dapat sepenuhnya mencegah siswa membuka aplikasi lain atau memakai perangkat kedua.

## Memperbarui aplikasi

Setelah mengganti file di GitHub, tunggu deployment selesai lalu muat ulang. Bila versi lama masih tampil:

1. Tutup aplikasi/PWA.
2. Hapus cache situs, atau uninstall PWA.
3. Buka kembali link GitHub Pages.

Service worker versi ini menggunakan cache `cbt-smp-ready-v3`.
