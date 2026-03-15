# 🎓 Attend-Vision AI — Face Recognition Attendance System

> **Fully automated, AI-powered attendance tracking for universities.** Upload a classroom photo → faces are detected, matched against the student database → attendance is recorded. No manual marking. No roll calls.

---

## ✨ Key Features

- 🤖 **AI-Powered Face Recognition** — Uses InsightFace (`buffalo_l`) with cosine similarity + margin thresholding for accurate, robust identification even on low-resolution classroom photos
- 🏛️ **Multi-Tenant Architecture** — One deployment supports multiple universities, each fully isolated with their own courses, professors, and students
- 👥 **4-Role RBAC** — `hq_admin` → `uni_admin` → `professor` → `student`, with JWT-based authentication
- 📸 **One-Click Attendance** — Professors upload a single class photo; detection, recognition, and DB persistence happen automatically
- 📊 **Student Dashboard** — Students see their per-course attendance %, at-risk warnings, session history, and anonymized classmate comparisons
- 📧 **Automated Email Onboarding** — New university admins receive credentials via email on signup
- 📥 **CSV Export** — Download per-session attendance sheets with one click
- ⚡ **Bulk Student Import** — Upload a CSV/ZIP to enroll entire cohorts at once
- 🛠️ **Manual Override** — Professors can manually mark individual students present or absent post-session

---

## 🏗️ Architecture Overview

```
attend-vision/
│
├── Backend (FastAPI)
│   ├── main.py               # All API routes & business logic
│   ├── database.py           # SQLAlchemy ORM models & DB setup
│   ├── auth.py               # JWT auth, bcrypt hashing, RBAC
│   └── init_system.py        # Seeds the root HQ admin account
│
├── ML Pipeline (ml_logic/)
│   ├── Detect_faces.py       # RetinaFace face detection & cropping
│   ├── Get_embedding.py      # InsightFace embedding extraction
│   ├── Build_database.py     # Builds the per-course embedding bank (.npy + .pkl)
│   ├── Match_faces.py        # Top-K L2 + cosine similarity matching
│   ├── Save_attendance_analyze.py  # CSV generation & evaluation utilities
│   └── Global_variables.py   # ML config constants
│
└── Frontend (React + Vite)
    ├── App.jsx               # All dashboard views (HQ, Uni Admin, Professor, Student)
    ├── main.jsx              # App entry point
    ├── App.css               # Component & animation styles
    └── index.css             # Tailwind theme + global styles
```

### System Flow

```
Professor uploads photo
        │
        ▼
  [RetinaFace] Detect & crop all faces
        │
        ▼
  [InsightFace buffalo_l] Extract 512-d embeddings
        │
        ▼
  Top-K L2 search on pre-built course embedding bank
        │
        ▼
  Cosine similarity + margin threshold filter
        │
        ▼
  Match roll numbers → Write AttendanceRecords to DB
        │
        ▼
  Professor & Students see live results on dashboard
```

---

## 🗄️ Database Schema

| Table | Description |
|-------|-------------|
| `universities` | Each partner institution |
| `users` | All user accounts (all roles), linked to a university |
| `courses` | Courses per university (unique by `course_code + university_id`) |
| `enrollments` | Many-to-many: users ↔ courses |
| `attendance_sessions` | One record per class session |
| `attendance_records` | One record per student per session (defaults to PRESENT) |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.9+
- Node.js 18+
- A Gmail account (or any SMTP provider) for email notifications

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/attend-vision.git
cd attend-vision
```

### 2. Backend Setup

```bash
# Install Python dependencies
pip install fastapi uvicorn sqlalchemy python-jose passlib bcrypt \
            insightface retinaface-pytorch opencv-python pillow \
            pillow-heif numpy fastapi-mail pydantic[email] python-multipart

# Seed the root admin account (creates user: admin / pass: hq_pass_123)
python init_system.py

# Start the API server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

> ⚠️ **Change the default HQ admin password immediately after first login.**

### 3. Frontend Setup

```bash
cd frontend   # or wherever your React files are
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### 4. Configure Email (Optional but Recommended)

In `main.py`, update the SMTP configuration:

```python
conf = ConnectionConfig(
    MAIL_USERNAME = "your_email@gmail.com",
    MAIL_PASSWORD = "your_app_password",   # Use an App Password, not your account password
    MAIL_FROM     = "noreply@yourdomain.com",
    MAIL_PORT     = 587,
    MAIL_SERVER   = "smtp.gmail.com",
    MAIL_STARTTLS = True,
    MAIL_SSL_TLS  = False,
    USE_CREDENTIALS = True,
)
```

---

## 🔐 Authentication & Roles

All protected routes use **JWT Bearer tokens** (10-hour expiry).

| Role | Capabilities |
|------|-------------|
| `hq_admin` | Onboard universities, view all university stats, remove universities |
| `uni_admin` | Create courses, manage professors & students, build face DB, bulk enroll |
| `professor` | Upload attendance photos, view session results, manual overrides, download CSV |
| `student` | View own attendance %, per-session history, at-risk warnings, classmate leaderboard |

Login endpoint: `POST /api/login` (form data: `username`, `password`)

---

## 🤖 ML Pipeline Details

### Face Detection
[RetinaFace](https://github.com/serengil/retinaface) is used for high-accuracy face detection with configurable confidence threshold (`conf_th=0.9`) and optional bounding box tightening to handle overlapping faces in group photos.

### Face Recognition
[InsightFace](https://github.com/deepinsight/insightface) with the `buffalo_l` model produces 512-dimensional L2-normalized embeddings. Matching uses a two-stage strategy:

1. **Top-K L2 search** (vectorized via NumPy) narrows candidates to K=10
2. **Cosine similarity** on those K candidates for the final match

A match is accepted only if:
```
cosine_score ≥ COSINE_THRESHOLD (0.25)
AND
margin (best_score - 2nd_best_score) ≥ MARGIN_THRESHOLD (0.06)
```
The margin check prevents false positives in crowded, similar-looking cohorts.

### Low-Resolution Handling
The pipeline includes preprocessing for low-res face crops:
- Upscaling to minimum dimensions via `INTER_CUBIC` interpolation
- CLAHE contrast enhancement
- Reflective padding to reach 112×112 before embedding
- Automatic fallback with multiple `det_size` values if initial detection fails

### Building the Course Face Database

```bash
# After uploading student photos to data/<course_code>/DB_images/
# Photo naming convention: <roll_no>_<optional_anything>.jpg

POST /api/admin/build-db/{course_code}
```
This generates `embs.npy` (embedding matrix) and `rollno.pkl` (ID map) for that course.

---

## 📡 API Reference

### Authentication
| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/login` | Public | Get JWT token |

### HQ Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/onboard_university` | Create university + admin, send welcome email |
| GET | `/api/admin/stats` | Overview of all universities |
| DELETE | `/api/admin/universities/{id}` | Remove university and all its data |

### University Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/uni/dashboard` | Courses, stats overview |
| POST | `/api/uni/courses` | Create a course |
| DELETE | `/api/uni/courses/{id}` | Delete a course |
| POST | `/api/uni/professors` | Add a professor account |
| POST | `/api/uni/students` | Add a student account |
| POST | `/api/uni/courses/{id}/assign-professor` | Assign professor to course |
| POST | `/api/uni/courses/{id}/enroll-student` | Enroll student in course |
| POST | `/api/uni/bulk-upload` | Bulk import students from CSV/ZIP |
| POST | `/api/admin/build-db/{course_code}` | Build face embedding database |

### Professor
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/professor/courses` | List assigned courses |
| POST | `/api/professor/process-attendance` | Upload photo → auto-mark attendance |
| GET | `/api/professor/sessions/{id}/roster` | Full roster with present/absent status |
| PATCH | `/api/professor/sessions/{id}/students/{sid}` | Manual attendance override |
| GET | `/api/professor/sessions/{id}/download-csv` | Export session CSV |

### Student
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/student/overview` | Attendance % for all enrolled courses |
| GET | `/api/student/courses/{id}/sessions` | Per-session history for a course |
| GET | `/api/student/courses/{id}/classmates` | Anonymized classmate attendance leaderboard |

---

## ⚙️ Configuration

Key ML parameters in `main.py`:

```python
ML_CONFIG = {
    "COSINE_TH": 0.25,      # Min cosine score to accept a match
    "MARGIN_TH": 0.06,      # Min gap between 1st and 2nd best match
    "TOP_K":     10,         # Candidates shortlisted before cosine re-rank
    "IMG_EXTS":  {".jpg", ".jpeg", ".png", ".webp"}
}
```

JWT settings in `auth.py`:

```python
SECRET_KEY = "YOUR_SUPER_SECRET_KEY_KEEP_IT_SAFE"   # ← Change this!
ACCESS_TOKEN_EXPIRE_MINUTES = 600                    # 10 hours
```

---

## 🔒 Security Notes

> Before deploying to production, address the following:

- **Change `SECRET_KEY`** in `auth.py` to a long random string (e.g., `openssl rand -hex 32`)
- **Restrict CORS** in `main.py` — replace `allow_origins=["*"]` with your frontend domain
- **Remove hardcoded SMTP credentials** from `main.py` — use environment variables instead
- **Change the default HQ admin password** after running `init_system.py`
- Consider switching from SQLite to PostgreSQL for production deployments

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI (Python) |
| Database | SQLite via SQLAlchemy ORM |
| Authentication | JWT (python-jose) + bcrypt |
| Face Detection | RetinaFace |
| Face Recognition | InsightFace `buffalo_l` |
| Image Processing | OpenCV, Pillow |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| Email | fastapi-mail (SMTP) |

---

## 📄 License

This project is released under the MIT License. See `LICENSE` for details.

---

<p align="center">
  Attend-Vision AI © 2026 — Empowering Smarter Campuses
</p>
