# Kata sandi database di deploy

`docker/init-roles.sql` membuat peran database dengan kata sandi **pengembangan** yang diketahui publik
(`solva_owner` / `solva_owner_dev`, `solva_app_login` / `solva_app_dev`), dan `compose.yaml` memakai
`postgres` / `postgres` untuk superuser. Nilai ini hanya untuk komputer lokal dan CI. Di server deploy
ganti semuanya sebelum aplikasi menerima lalu lintas nyata.

## Volume data baru (belum pernah diinisialisasi)

Set variabel berikut di lingkungan tempat `docker compose` dijalankan (file `.env` di folder proyek,
jangan di-commit) sebelum `docker compose up` pertama:

```text
POSTGRES_PASSWORD=<acak panjang>
SOLVA_OWNER_PASSWORD=<acak panjang>
SOLVA_APP_PASSWORD=<acak panjang>
```

`docker/rotate-role-passwords.sh` berjalan satu kali saat inisialisasi dan mengganti kata sandi
`solva_owner` dan `solva_app_login`. Tanpa variabel itu skrip tidak melakukan apa pun.

## Volume yang sudah berjalan

Skrip inisialisasi tidak dijalankan ulang pada volume yang sudah ada. Ganti kata sandi secara manual:

```powershell
docker compose exec db psql -U postgres -c "ALTER ROLE solva_owner PASSWORD '<baru>'"
docker compose exec db psql -U postgres -c "ALTER ROLE solva_app_login PASSWORD '<baru>'"
docker compose exec db psql -U postgres -c "ALTER ROLE postgres PASSWORD '<baru>'"
```

## Setelah mengganti kata sandi

- Perbarui `DATABASE_URL` (peran `solva_app_login`) dan `DATABASE_OWNER_URL` (peran `solva_owner`) di
  lingkungan aplikasi dan migrator, lalu jalankan ulang container `app` dan `migrator`.
- Port database terikat ke `127.0.0.1` (lihat `compose.yaml`); jangan membukanya ke jaringan publik.
- Jangan memakai kata sandi pengembangan di staging maupun produksi.
