# Mengganti Versi Demo Menjadi Versi Siap Pakai

## Sebelum mulai

Versi baru tidak memakai akun `guru/guru123`, `siswa01`, atau ujian contoh. Anda akan membuat administrator sendiri melalui wizard pertama.

## A. Bila database demo belum berisi data penting

1. Buka Supabase → **SQL Editor**.
2. Jalankan seluruh isi `RESET-DATABASE.sql`.
3. Jalankan seluruh isi `database.sql`.
4. Buka repository GitHub lama.
5. Ganti file aplikasi lama dengan file versi baru ini.
6. Edit `config.js` menggunakan Project URL dan Publishable/anon key Anda.
7. Commit perubahan dan tunggu GitHub Pages selesai melakukan deployment.
8. Buka link aplikasi melalui tab samaran/incognito.
9. Isi wizard untuk membuat sekolah dan akun administrator.

`RESET-DATABASE.sql` menghapus semua siswa, soal, jawaban, dan hasil. Jangan gunakan langkah ini bila sudah ada data nyata.

## B. Bila database demo sudah berisi data penting

Jangan menjalankan reset. Pilihan paling aman adalah:

1. Ekspor hasil CSV dan snapshot JSON dari aplikasi lama.
2. Buat project Supabase baru.
3. Jalankan `database.sql` versi baru pada project baru.
4. Masukkan URL dan key project baru ke `config.js`.
5. Unggah file aplikasi baru ke GitHub.
6. Buat administrator melalui wizard.
7. Impor ulang siswa melalui CSV dan buat ulang ujian yang masih diperlukan.

## Bila halaman lama masih muncul

1. Tunggu status deployment GitHub Pages selesai.
2. Buka link dengan parameter sementara, misalnya `?v=3`.
3. Hapus cache situs di Chrome.
4. Bila aplikasi pernah dipasang sebagai PWA, uninstall lalu pasang kembali.
