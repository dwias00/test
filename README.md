# CBT SMP Central — Database Terpusat

Aplikasi CBT berbasis web/PWA yang dapat dibuka dari HP Android. Guru, siswa, ujian, pengerjaan, dan nilai tersimpan pada satu database Supabase sehingga seluruh perangkat melihat data yang sama.

## Akun awal

Setelah `database.sql` dijalankan:

- Guru: `guru` / `guru123`
- Siswa: `siswa01` / `smp123`
- Siswa: `siswa02` / `smp123`

Segera ganti kata sandi demo sebelum dipakai sungguhan. Kata sandi siswa dapat diubah dari menu **Siswa**. Untuk mengganti kata sandi guru, lihat bagian “Mengganti kata sandi guru”.

## Fitur versi terpusat

- Login guru dan siswa dari perangkat berbeda
- Akun dan kelas siswa tersimpan terpusat
- Guru membuat, mengedit, mengaktifkan, menduplikasi, dan menghapus ujian
- Bank soal pilihan ganda, acak soal, dan acak jawaban
- Jawaban siswa disimpan otomatis ke database
- Pengerjaan dapat dilanjutkan dari perangkat lain selama waktu belum habis
- Timer dihitung dari waktu server database
- Jawaban benar tidak dikirim ke dashboard siswa
- Nilai dihitung di database, bukan dipercaya dari browser siswa
- Rekap nilai guru dan ekspor CSV/JSON
- Kata sandi disimpan sebagai hash `bcrypt` melalui `pgcrypto`
- RLS aktif dan tabel tidak dapat dibaca langsung dengan publishable/anon key

## Langkah 1 — Membuat Supabase dari HP

1. Buka dashboard Supabase melalui Chrome dan buat project baru.
2. Simpan password database project Anda di tempat aman.
3. Setelah project aktif, buka **SQL Editor**.
4. Buka file `database.sql` dari paket ini, salin seluruh isinya, lalu jalankan di SQL Editor.
5. Pastikan tidak ada pesan error.

`database.sql` membuat tabel, aturan keamanan, fungsi RPC, akun demo, dan satu ujian contoh.

## Langkah 2 — Mengisi koneksi

Buka **Project Settings / API** atau halaman **Connect** pada dashboard Supabase, lalu salin:

- Project URL, contoh `https://abcdefgh.supabase.co`
- Publishable key (`sb_publishable_...`) atau legacy anon key (`eyJ...`)

Ada dua cara:

### Cara yang disarankan untuk dibagikan ke siswa

Edit file `config.js`:

```js
window.CBT_CONFIG = {
  supabaseUrl: "https://PROJECT-ANDA.supabase.co",
  supabaseAnonKey: "PUBLISHABLE-KEY-ANDA"
};
```

Publishable/anon key memang dirancang untuk frontend. **Jangan pernah** memasukkan `service_role` key ke file aplikasi.

### Cara uji cepat tanpa mengedit file

Buka aplikasi, isi formulir **Hubungkan Database**, lalu simpan. Konfigurasi ini hanya tersimpan pada browser perangkat tersebut, sehingga tidak cocok untuk link yang langsung dibagikan ke banyak siswa.

## Langkah 3 — Mengunggah aplikasi

Unggah seluruh isi folder ini ke hosting HTTPS. Pilihan sederhana:

### GitHub Pages

1. Buat repository baru.
2. Unggah semua file dan folder: `index.html`, `app.js`, `app.css`, `config.js`, `manifest.webmanifest`, `sw.js`, dan folder `icons`.
3. Buka **Settings → Pages**.
4. Pilih **Deploy from a branch**, branch `main`, folder `/root`.
5. Buka link Pages yang dihasilkan dan login dengan akun demo.

File `database.sql` dan README boleh tetap disimpan di repository, tetapi jangan simpan password database atau service role key.

## Langkah 4 — Pengujian sebelum digunakan

1. Login sebagai guru dan buat satu ujian pendek.
2. Aktifkan ujian untuk kelas `VIII A`.
3. Buka link menggunakan browser/perangkat lain.
4. Login sebagai `siswa01` dan kerjakan ujian.
5. Kembali ke akun guru, buka **Hasil**, lalu tekan **Muat ulang data** bila hasil belum tampak.
6. Uji koneksi dengan beberapa siswa sebelum digunakan satu kelas penuh.

## Mengganti kata sandi guru

Jalankan SQL berikut di SQL Editor. Ganti teks di dalam tanda kutip:

```sql
update public.app_users
set password_hash = extensions.crypt('KATA_SANDI_BARU', extensions.gen_salt('bf')),
    updated_at = now()
where lower(username) = 'guru';
```

Gunakan kata sandi yang tidak mudah ditebak.

## Menambah guru kedua

```sql
insert into public.app_users(username, password_hash, name, role, class_name)
values (
  'guru2',
  extensions.crypt('KATA_SANDI_GURU2', extensions.gen_salt('bf')),
  'Nama Guru Kedua',
  'teacher',
  ''
);
```

## Struktur file

- `index.html` — struktur antarmuka
- `app.css` — desain responsif
- `app.js` — logika aplikasi dan komunikasi database
- `config.js` — Project URL dan publishable/anon key
- `database.sql` — skema database, keamanan, RPC, dan data contoh
- `manifest.webmanifest` — konfigurasi instalasi PWA
- `sw.js` — cache antarmuka aplikasi
- `icons/` — ikon aplikasi

## Catatan keamanan dan operasional

- Sistem ini lebih aman daripada versi localStorage karena jawaban benar dan perhitungan nilai berada di database.
- Token login aplikasi berlaku tujuh hari dan dapat dicabut saat pengguna logout.
- Publishable/anon key bukan rahasia; keamanan bergantung pada RLS, izin tabel, dan fungsi RPC dalam `database.sql`.
- Jangan menonaktifkan RLS dan jangan memberi akses langsung tabel kepada role `anon`.
- Service worker hanya menyimpan antarmuka. Login, sinkronisasi, dan pengumpulan ujian tetap memerlukan internet.
- Untuk ujian resmi berskala besar, tambahkan pengujian beban, kebijakan privasi sekolah, backup rutin, jadwal ujian, token ujian, dan pemantauan perangkat.

## Memperbarui aplikasi

Setelah mengganti file pada hosting, tutup lalu buka ulang aplikasi. Bila versi lama masih muncul, hapus cache situs atau uninstall PWA lalu pasang kembali.
