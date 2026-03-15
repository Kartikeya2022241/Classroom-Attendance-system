import os, shutil, uuid, zipfile, tempfile, threading
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from insightface.app import FaceAnalysis
from pydantic import BaseModel

# Local Imports
from database import SessionLocal, User, Course, University, AttendanceSession, AttendanceRecord, get_db
from auth import hash_password, verify_password, create_access_token, get_current_user, check_role
from ml_logic.Detect_faces import detect_and_save_faces
from ml_logic.Match_faces import run_queries
from ml_logic.Build_database import build_database


from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.requests import Request

# Replace with your actual SMTP provider details (e.g., Gmail, SendGrid)
conf = ConnectionConfig(
    MAIL_USERNAME = "kartikeya22241@iiitd.ac.in",
    MAIL_PASSWORD = "zwlo hxza nmxz tlow",
    MAIL_FROM = "admin@ai-attendance.com",
    MAIL_PORT = 587,
    MAIL_SERVER = "smtp.gmail.com",
    MAIL_STARTTLS = True,
    MAIL_SSL_TLS = False,
    USE_CREDENTIALS = True,
    VALIDATE_CERTS = True
)

app = FastAPI(title="AI Attendance System")

# Global Model Initialization
face_model = FaceAnalysis(name="buffalo_l", providers=['CPUExecutionProvider'])
face_model.prepare(ctx_id=0, det_size=(64, 64))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Access-Control-Allow-Origin": "*"},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
        headers={"Access-Control-Allow-Origin": "*"},
    )

# Constants (Moved from Global_variables to central config)
ML_CONFIG = {
    "COSINE_TH": 0.25,
    "MARGIN_TH": 0.06,
    "TOP_K": 10,
    "IMG_EXTS": {".jpg", ".jpeg", ".png", ".webp"}
}

# def get_db():
#     db = SessionLocal()
#     try: yield db
#     finally: db.close()

# --- AUTHENTICATION ---
@app.post("/api/login")
async def login(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid credentials")
    
    token = create_access_token(data={"sub": user.username})
    return {"access_token": token, "token_type": "bearer", "role": user.role}

class UniversityCreate(BaseModel):
    name: str


# In main.py
from pydantic import EmailStr

class UniversityOnboard(BaseModel):
    uni_name: str
    admin_username: str
    admin_email: EmailStr
    admin_password: str # The HQ Admin sets this initial password

@app.post("/api/admin/onboard_university", dependencies=[Depends(check_role(["hq_admin"]))])
async def onboard_university(data: UniversityOnboard, db: Session = Depends(get_db)):
    # 1. Check if University or User already exists
    if db.query(University).filter(University.name == data.uni_name).first():
        raise HTTPException(status_code=400, detail="University already exists")
    
    if db.query(User).filter(User.username == data.admin_username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    
    if db.query(User).filter(User.email == data.admin_email).first():
        raise HTTPException(status_code=400, detail="Email already in use")

    # 2. Create University
    new_uni = University(name=data.uni_name)
    db.add(new_uni)
    db.flush() # Get the new university ID without committing the transaction yet

    # 3. Create University Admin User linked to this university
    new_admin = User(
        username=data.admin_username,
        email=data.admin_email,
        password_hash=hash_password(data.admin_password), # Uses auth.py hashing
        role="uni_admin",
        university_id=new_uni.id
    )
    db.add(new_admin)
    db.commit()

    # 4. Prepare and Send Email
    html = f"""
    <h3>University Onboarding Successful</h3>
    <p>The university <b>{data.uni_name}</b> has been registered.</p>
    <p><b>Your Admin Credentials:</b></p>
    <ul>
        <li>Username: {data.admin_username}</li>
        <li>Temporary Password: {data.admin_password}</li>
    </ul>
    <p>Please log in and change your password immediately.</p>
    """

    message = MessageSchema(
        subject="University Admin Access - AI Attendance System",
        recipients=[data.admin_email],
        body=html,
        subtype=MessageType.html
    )

    fm = FastMail(conf) # Uses the ConnectionConfig you added to main.py
    await fm.send_message(message)

    return {"message": f"University '{data.uni_name}' created and email sent to admin."}

# --- UNI ADMIN: Course & Student Enrollment ---
@app.post("/api/admin/create-course", dependencies=[Depends(check_role(["uni_admin"]))])
async def create_course(course_code: str, uni_id: int, db: Session = Depends(get_db)):
    course = Course(course_code=course_code, university_id=uni_id)
    db.add(course)
    db.commit()
    os.makedirs(f"data/{course_code}/DB_images", exist_ok=True)
    return {"status": "Course Created", "path": f"data/{course_code}"}

@app.post("/api/admin/build-db/{course_code}", dependencies=[Depends(check_role(["uni_admin"]))])
async def process_course_db(course_code: str):
    """Processes images in DB_images folder to create embeddings."""
    base_path = f"data/{course_code}"
    build_database(
        db_path=f"{base_path}/DB_images",
        img_exts=ML_CONFIG["IMG_EXTS"],
        model_name="buffalo_l",
        emb_file=f"{base_path}/embs.npy",
        rollno_file=f"{base_path}/rollno.pkl",
        model_app=face_model
    )
    return {"status": "ML Database Synchronized"}

# --- PROFESSOR: Upload & Process ---
@app.post("/api/professor/process-attendance", dependencies=[Depends(check_role(["professor"]))])
async def process_attendance(
    course_id: int, 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db)
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course: raise HTTPException(status_code=404, detail="Course not found")

    session_id = str(uuid.uuid4())
    session_dir = f"sessions/{session_id}"
    os.makedirs(f"{session_dir}/crops", exist_ok=True)
    
    photo_path = f"{session_dir}/{file.filename}"
    with open(photo_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        # 1. Detection
        detect_and_save_faces(photo_path, 0, output_folder=f"{session_dir}/crops", shrink=0)
        
        # 2. Matching
        results, _ = run_queries(
            query_path=f"{session_dir}/crops",
            db_path=f"data/{course.course_code}/DB_images",
            emb_file=f"data/{course.course_code}/embs.npy",
            rollno_file=f"data/{course.course_code}/rollno.pkl",
            model_app=face_model,
            cosine_th=ML_CONFIG["COSINE_TH"],
            margin_th=ML_CONFIG["MARGIN_TH"],
            model_name="buffalo_l",
            top_k=ML_CONFIG["TOP_K"],
            img_exts=ML_CONFIG["IMG_EXTS"]
        )

        present_rolls = list(set([v for v in results.values() if v != "UNKNOWN"]))
        
        # 3. SQL Persistence
        new_sess = AttendanceSession(course_id=course.id)
        db.add(new_sess)
        db.flush()

        for roll in present_rolls:
            student = db.query(User).filter(User.roll_no == roll).first()
            if student:
                record = AttendanceRecord(session_id=new_sess.id, student_id=student.id)
                db.add(record)
        
        db.commit()
        return {"present_students": present_rolls, "total_detected": len(results)}

    finally:
        shutil.rmtree(session_dir)

# --- STUDENT: Personal Reports ---
@app.get("/api/student/report", dependencies=[Depends(check_role(["student"]))])
async def get_my_report(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user = db.merge(current_user)
    db.refresh(current_user)
    report = []
    # Loop through courses student is enrolled in
    for course in current_user.courses:
        total = db.query(AttendanceSession).filter(AttendanceSession.course_id == course.id).count()
        attended = db.query(AttendanceRecord).filter(
            AttendanceRecord.student_id == current_user.id,
            AttendanceRecord.session.has(course_id=course.id)
        ).count()
        
        report.append({
            "course": course.course_code,
            "attendance": f"{int((attended/total)*100) if total > 0 else 0}%"
        })
    return report


# Add this to main.py
@app.get("/api/admin/stats", dependencies=[Depends(check_role(["hq_admin"]))])
async def get_admin_stats(db: Session = Depends(get_db)):
    universities = db.query(University).all()
    
    # Format the data so the frontend can map over it easily
    stats_data = []
    for uni in universities:
        stats_data.append({
            "id": uni.id,
            "name": uni.name,
            "course_count": len(uni.courses) # Calculates count from the relationship
        })
    
    return stats_data # Returns the list directly


# --- HQ ADMIN: University Management ---
# @app.post("/api/admin/onboard_university", dependencies=[Depends(check_role(["hq_admin"]))])
# async def onboard_university(name: str = Form(...), db: Session = Depends(get_db)):
#     # Check if university already exists
#     existing_uni = db.query(University).filter(University.name == name).first()
#     if existing_uni:
#         raise HTTPException(status_code=400, detail="University already exists")
    
#     new_uni = University(name=name)
#     db.add(new_uni)
#     db.commit()
#     db.refresh(new_uni)
#     return {"message": f"University '{name}' onboarded successfully", "id": new_uni.id}


# --- HQ ADMIN: University Management ---

@app.delete("/api/admin/university/{uni_id}", dependencies=[Depends(check_role(["hq_admin"]))])
async def delete_university(uni_id: int, db: Session = Depends(get_db)):
    university = db.query(University).filter(University.id == uni_id).first()
    if not university:
        raise HTTPException(status_code=404, detail="University not found")

    # Snapshot courses list before modifying to avoid mutating collection while iterating
    courses_snapshot = list(university.courses)

    # 1. Delete all attendance records for sessions belonging to this university's courses
    for course in courses_snapshot:
        for session in list(course.attendance_sessions):
            db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).delete()
            db.delete(session)

    # 2. Delete all courses belonging to this university
    for course in courses_snapshot:
        db.delete(course)

    # 3. Delete all users (admins, professors, students) linked to this university
    db.query(User).filter(User.university_id == uni_id).delete()

    # 4. Finally delete the university itself
    db.delete(university)
    db.commit()
    return {"message": f"University '{university.name}' and all associated data removed successfully"}

# ============================================================
# UNI ADMIN: Full Dashboard Endpoints
# ============================================================

# --- Get this uni admin's own university info + courses ---
@app.get("/api/uni/dashboard")
async def get_uni_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role not in ["uni_admin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    uni = db.query(University).filter(University.id == current_user.university_id).first()
    if not uni:
        raise HTTPException(status_code=404, detail="University not found")
    
    courses_data = []
    for c in uni.courses:
        # Find professor assigned to this course (role=professor, enrolled)
        professor = db.query(User).filter(
            User.university_id == uni.id,
            User.role == "professor"
        ).join(User.courses).filter(Course.id == c.id).first()
        
        student_count = db.query(User).filter(
            User.role == "student"
        ).join(User.courses).filter(Course.id == c.id).count()
        
        session_count = db.query(AttendanceSession).filter(
            AttendanceSession.course_id == c.id
        ).count()
        
        courses_data.append({
            "id": c.id,
            "course_code": c.course_code,
            "professor": professor.username if professor else None,
            "professor_id": professor.id if professor else None,
            "student_count": student_count,
            "session_count": session_count,
        })
    
    # Stats
    total_students = db.query(User).filter(
        User.university_id == uni.id,
        User.role == "student"
    ).count()
    total_professors = db.query(User).filter(
        User.university_id == uni.id,
        User.role == "professor"
    ).count()
    total_sessions = db.query(AttendanceSession).join(Course).filter(
        Course.university_id == uni.id
    ).count()

    return {
        "university": {"id": uni.id, "name": uni.name},
        "courses": courses_data,
        "stats": {
            "total_courses": len(uni.courses),
            "total_students": total_students,
            "total_professors": total_professors,
            "total_sessions": total_sessions,
        }
    }


# --- List all professors in this university ---
@app.get("/api/uni/professors")
async def get_professors(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    professors = db.query(User).filter(
        User.university_id == current_user.university_id,
        User.role == "professor"
    ).all()
    return [{"id": p.id, "username": p.username, "email": p.email} for p in professors]


# --- List all students in this university ---
@app.get("/api/uni/students")
async def get_students(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    students = db.query(User).filter(
        User.university_id == current_user.university_id,
        User.role == "student"
    ).all()
    return [{"id": s.id, "username": s.username, "email": s.email, "roll_no": s.roll_no} for s in students]


class CreateCourseBody(BaseModel):
    course_code: str

# --- Create a course for this university ---
@app.post("/api/uni/courses")
async def uni_create_course(
    body: CreateCourseBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    existing = db.query(Course).filter(
        Course.course_code == body.course_code,
        Course.university_id == current_user.university_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Course code already exists in this university")
    
    course = Course(course_code=body.course_code, university_id=current_user.university_id)
    db.add(course)
    db.commit()
    db.refresh(course)
    os.makedirs(f"data/{body.course_code}/DB_images", exist_ok=True)
    return {"id": course.id, "course_code": course.course_code, "message": "Course created"}


# --- Delete a course ---
@app.delete("/api/uni/courses/{course_id}")
async def uni_delete_course(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    course = db.query(Course).filter(
        Course.id == course_id,
        Course.university_id == current_user.university_id
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    # Cascade: delete sessions + records
    for session in course.attendance_sessions:
        db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session.id).delete()
        db.delete(session)
    
    db.delete(course)
    db.commit()
    return {"message": f"Course '{course.course_code}' deleted"}


class CreateUserBody(BaseModel):
    username: str
    email: str
    password: str
    roll_no: str = None  # for students only

# --- Add a professor ---
@app.post("/api/uni/professors")
async def create_professor(
    body: CreateUserBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")
    
    prof = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role="professor",
        university_id=current_user.university_id
    )
    db.add(prof)
    db.commit()
    db.refresh(prof)
    return {"id": prof.id, "username": prof.username, "message": "Professor created"}


# --- Add a student ---
@app.post("/api/uni/students")
async def create_student(
    body: CreateUserBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already in use")
    
    student = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role="student",
        roll_no=body.roll_no,
        university_id=current_user.university_id
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return {"id": student.id, "username": student.username, "message": "Student created"}


# --- Delete a professor or student ---
@app.delete("/api/uni/users/{user_id}")
async def delete_uni_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    user = db.query(User).filter(
        User.id == user_id,
        User.university_id == current_user.university_id,
        User.role.in_(["professor", "student"])
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": f"User '{user.username}' removed"}


class AssignProfessorBody(BaseModel):
    professor_id: int

# --- Assign a professor to a course (enroll in course) ---
@app.post("/api/uni/courses/{course_id}/assign-professor")
async def assign_professor(
    course_id: int,
    body: AssignProfessorBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    course = db.query(Course).filter(Course.id == course_id, Course.university_id == current_user.university_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    professor = db.query(User).filter(User.id == body.professor_id, User.role == "professor").first()
    if not professor:
        raise HTTPException(status_code=404, detail="Professor not found")
    
    if course not in professor.courses:
        professor.courses.append(course)
        db.commit()
    return {"message": f"Professor '{professor.username}' assigned to '{course.course_code}'"}


class EnrollStudentBody(BaseModel):
    student_id: int

# --- Enroll a student in a course ---
@app.post("/api/uni/courses/{course_id}/enroll-student")
async def enroll_student(
    course_id: int,
    body: EnrollStudentBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    course = db.query(Course).filter(Course.id == course_id, Course.university_id == current_user.university_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    student = db.query(User).filter(User.id == body.student_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    if course not in student.courses:
        student.courses.append(course)
        db.commit()
    return {"message": f"Student '{student.username}' enrolled in '{course.course_code}'"}


# --- Remove a student from a course ---
@app.delete("/api/uni/courses/{course_id}/students/{student_id}")
async def unenroll_student(
    course_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    course = db.query(Course).filter(Course.id == course_id, Course.university_id == current_user.university_id).first()
    student = db.query(User).filter(User.id == student_id, User.role == "student").first()
    if not course or not student:
        raise HTTPException(status_code=404, detail="Not found")
    
    if course in student.courses:
        student.courses.remove(course)
        db.commit()
    return {"message": "Student unenrolled"}


# --- Get students enrolled in a specific course ---
@app.get("/api/uni/courses/{course_id}/students")
async def get_course_students(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    
    course = db.query(Course).filter(Course.id == course_id, Course.university_id == current_user.university_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    enrolled = db.query(User).filter(User.role == "student").join(User.courses).filter(Course.id == course_id).all()
    return [{"id": s.id, "username": s.username, "roll_no": s.roll_no} for s in enrolled]


# ============================================================
# UNI ADMIN: Bulk Student Upload via ZIP
# ============================================================

# In-memory job store for progress reporting
_bulk_jobs: dict = {}   # job_id -> {"status": str, "log": [str], "done": bool, "counts": dict}

def _run_bulk_build(job_id: str, course_id: int, extract_dir: str, db_path: str,
                    emb_file: str, rollno_file: str, university_id: int,
                    enroll: bool, db_factory):
    """
    Runs in a background thread.
    Extracts faces, builds the InsightFace embedding DB, optionally creates
    Student records in the DB and enrolls them in the course.
    """
    job = _bulk_jobs[job_id]
    log = job["log"]

    def info(msg):
        log.append(msg)
        print(f"[BulkBuild/{job_id[:8]}] {msg}")

    IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}

    try:
        # 1. Collect image files
        files = [
            f for f in sorted(os.listdir(extract_dir))
            if os.path.splitext(f)[1].lower() in IMG_EXTS
        ]
        info(f"Found {len(files)} image(s) in ZIP.")

        if not files:
            job["status"] = "error"
            job["done"] = True
            info("❌ No valid images found. Upload aborted.")
            return

        import cv2, numpy as np, pickle
        from ml_logic.Get_embedding import get_embedding

        # 2. Build embeddings (reuse face_model from main module scope)
        rollno_map, embs, skipped = [], [], []

        for i, fname in enumerate(files, 1):
            rollno = os.path.splitext(fname)[0].split("_")[0]
            fpath  = os.path.join(extract_dir, fname)
            img    = cv2.imread(fpath)

            if img is None:
                info(f"  [{i}/{len(files)}] ⚠️  {fname} — cannot read, skipping.")
                skipped.append(fname)
                continue

            h, w = img.shape[:2]
            emb = get_embedding(img, face_model, "buffalo_l")

            if emb is None:
                info(f"  [{i}/{len(files)}] ⚠️  {rollno} ({w}×{h}) — no face detected, skipping.")
                skipped.append(fname)
                continue

            rollno_map.append(rollno)
            embs.append(emb)
            info(f"  [{i}/{len(files)}] ✅ {rollno} ({w}×{h}) — embedded.")

        if not embs:
            job["status"] = "error"
            job["done"] = True
            info("❌ Could not generate any embeddings. Check image quality.")
            return

        # 3. Save / merge embeddings
        embs_np = np.vstack(embs).astype(np.float32)

        # If a previous DB exists, merge rather than overwrite
        if os.path.exists(emb_file) and os.path.exists(rollno_file):
            old_embs = np.load(emb_file).astype(np.float32)
            with open(rollno_file, "rb") as f:
                old_rollnos = pickle.load(f)

            # Deduplicate: skip roll numbers already in the bank
            new_mask = [r not in old_rollnos for r in rollno_map]
            if any(new_mask):
                merged_embs     = np.vstack([old_embs, embs_np[new_mask]])
                merged_rollnos  = old_rollnos + [r for r, m in zip(rollno_map, new_mask) if m]
                added = sum(new_mask)
            else:
                merged_embs, merged_rollnos, added = old_embs, old_rollnos, 0

            duplicates = len(rollno_map) - added
            info(f"Merged with existing DB: +{added} new, {duplicates} duplicate(s) skipped.")
        else:
            merged_embs, merged_rollnos = embs_np, rollno_map
            added = len(rollno_map)
            info(f"Created new embedding DB with {added} entries.")

        os.makedirs(os.path.dirname(emb_file), exist_ok=True)
        np.save(emb_file, merged_embs)
        with open(rollno_file, "wb") as f:
            pickle.dump(merged_rollnos, f)

        info(f"💾 Saved: {emb_file} — shape {merged_embs.shape}")

        # 4. Optionally create Student records + enroll in course
        students_created = 0
        students_enrolled = 0

        if enroll:
            db = db_factory()
            try:
                course = db.query(Course).filter(Course.id == course_id).first()

                for rollno in rollno_map:
                    # Check if student already exists by roll_no
                    student = db.query(User).filter(
                        User.roll_no == rollno,
                        User.university_id == university_id
                    ).first()

                    if not student:
                        # Auto-create student account: username = roll_no
                        username = rollno.lower()
                        # Make username unique if taken
                        suffix = 0
                        base_username = username
                        while db.query(User).filter(User.username == username).first():
                            suffix += 1
                            username = f"{base_username}_{suffix}"

                        student = User(
                            username=username,
                            email=f"{username}@placeholder.edu",
                            password_hash=hash_password(rollno),  # temp pass = roll_no
                            role="student",
                            roll_no=rollno,
                            university_id=university_id
                        )
                        db.add(student)
                        db.flush()
                        students_created += 1
                        info(f"  👤 Created student: {username} (roll={rollno})")

                    # Enroll if not already enrolled
                    if course and course not in student.courses:
                        student.courses.append(course)
                        students_enrolled += 1

                db.commit()
            except Exception as db_err:
                db.rollback()
                info(f"⚠️  DB error during student creation: {db_err}")
            finally:
                db.close()

        job["counts"] = {
            "total_images": len(files),
            "embedded": len(rollno_map),
            "skipped": len(skipped),
            "students_created": students_created,
            "students_enrolled": students_enrolled,
        }

        info("─" * 40)
        info(f"✅ Done! Embedded: {len(rollno_map)}, Skipped: {len(skipped)}, "
             f"Students created: {students_created}, Enrolled: {students_enrolled}")
        job["status"] = "done"

    except Exception as e:
        import traceback
        info(f"❌ Fatal error: {e}")
        info(traceback.format_exc())
        job["status"] = "error"
    finally:
        # Clean up temp dir
        shutil.rmtree(extract_dir, ignore_errors=True)
        job["done"] = True


@app.post("/api/uni/courses/{course_id}/bulk-upload")
async def bulk_upload_students(
    course_id: int,
    file: UploadFile = File(...),
    enroll: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Accept a ZIP of student face images (rollno_anything.jpg/.png).
    Extracts them, builds/merges the InsightFace embedding DB for that course,
    and optionally auto-creates Student records and enrolls them.
    Returns a job_id immediately; poll /api/uni/jobs/{job_id} for progress.
    """
    if current_user.role != "uni_admin":
        raise HTTPException(status_code=403, detail="Forbidden")

    course = db.query(Course).filter(
        Course.id == course_id,
        Course.university_id == current_user.university_id
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    # Save upload to temp file
    tmp_zip = tempfile.mktemp(suffix=".zip")
    with open(tmp_zip, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Extract to temp dir
    extract_dir = tempfile.mkdtemp(prefix=f"bulk_{course_id}_")
    try:
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            # Only extract images; skip __MACOSX and hidden files
            IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
            for member in zf.infolist():
                name = os.path.basename(member.filename)
                if not name or name.startswith(".") or "__MACOSX" in member.filename:
                    continue
                if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                    continue
                # Flatten directory structure — save all images directly into extract_dir
                target = os.path.join(extract_dir, name)
                with zf.open(member) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    except zipfile.BadZipFile:
        shutil.rmtree(extract_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Invalid or corrupt ZIP file")
    finally:
        os.remove(tmp_zip)

    # Paths for embedding DB
    base_path   = f"data/{course.course_code}"
    db_path     = f"{base_path}/DB_images"
    emb_file    = f"{base_path}/embs.npy"
    rollno_file = f"{base_path}/rollno.pkl"
    os.makedirs(db_path, exist_ok=True)

    # Copy extracted images into DB_images as well (so Match_faces can use them)
    for fname in os.listdir(extract_dir):
        src = os.path.join(extract_dir, fname)
        dst = os.path.join(db_path, fname)
        if not os.path.exists(dst):
            shutil.copy2(src, dst)

    # Create job
    job_id = str(uuid.uuid4())
    _bulk_jobs[job_id] = {
        "status": "running",
        "log": [f"Job {job_id[:8]} started for course '{course.course_code}'"],
        "done": False,
        "counts": {}
    }

    # Run in background thread so the endpoint returns immediately
    t = threading.Thread(
        target=_run_bulk_build,
        args=(job_id, course_id, extract_dir, db_path, emb_file, rollno_file,
              current_user.university_id, enroll, SessionLocal),
        daemon=True
    )
    t.start()

    return {"job_id": job_id, "message": "Processing started. Poll /api/uni/jobs/{job_id} for progress."}


@app.get("/api/uni/jobs/{job_id}")
async def get_job_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    """Poll this endpoint to get live log lines + completion status."""
    if current_user.role not in ["uni_admin", "hq_admin"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    job = _bulk_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "log": job["log"],
        "done": job["done"],
        "counts": job["counts"],
    }


# ============================================================
# PROFESSOR DASHBOARD ENDPOINTS
# ============================================================

from typing import List
from datetime import date as date_type

# --- Get professor's assigned courses ---
@app.get("/api/professor/my-courses")
async def get_my_courses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    current_user = db.merge(current_user)
    db.refresh(current_user)

    courses = []
    for course in current_user.courses:
        total_sessions = db.query(AttendanceSession).filter(
            AttendanceSession.course_id == course.id
        ).count()
        total_students = db.query(User).filter(
            User.role == "student"
        ).join(User.courses).filter(Course.id == course.id).count()
        courses.append({
            "id": course.id,
            "course_code": course.course_code,
            "total_sessions": total_sessions,
            "total_students": total_students,
        })
    return courses


# --- Process attendance: accepts MULTIPLE images + a custom date ---
@app.post("/api/professor/process-attendance-v2")
async def process_attendance_v2(
    course_id: int = Form(...),
    session_date: str = Form(...),   # ISO format: YYYY-MM-DD
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    # Validate date — no future dates allowed
    try:
        parsed_date = datetime.strptime(session_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    if parsed_date.date() > datetime.utcnow().date():
        raise HTTPException(status_code=400, detail="Cannot log attendance for a future date")

    course = db.query(Course).filter(
        Course.id == course_id
    ).join(User.courses).filter(User.id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=403, detail="You are not assigned to this course")

    # Check embedding DB exists
    emb_file    = f"data/{course.course_code}/embs.npy"
    rollno_file = f"data/{course.course_code}/rollno.pkl"
    if not os.path.exists(emb_file) or not os.path.exists(rollno_file):
        raise HTTPException(
            status_code=400,
            detail=f"No student database built for course '{course.course_code}'. Ask your admin to upload student images first."
        )

    session_uid = str(uuid.uuid4())
    session_dir = f"sessions/{session_uid}"
    crops_dir   = f"{session_dir}/crops"
    os.makedirs(crops_dir, exist_ok=True)

    all_present_rolls = set()
    total_detected    = 0

    try:
        for upload in files:
            ext = os.path.splitext(upload.filename)[1].lower()
            photo_path = f"{session_dir}/{uuid.uuid4()}{ext}"
            with open(photo_path, "wb") as buf:
                shutil.copyfileobj(upload.file, buf)

            per_crop_dir = f"{crops_dir}/{uuid.uuid4()}"
            os.makedirs(per_crop_dir, exist_ok=True)

            # detect_and_save_faces(path, start_count, ...) returns
            # start_count + number_of_faces_saved_in_this_image
            faces_before = 0
            faces_after  = detect_and_save_faces(
                photo_path, faces_before,
                output_folder=per_crop_dir, shrink=0
            )
            n_crops = faces_after - faces_before   # faces found in this image
            total_detected += n_crops

            # Only bother matching if faces were actually detected
            if n_crops == 0:
                continue

            results, _ = run_queries(
                query_path=per_crop_dir,
                db_path=f"data/{course.course_code}/DB_images",
                emb_file=emb_file,
                rollno_file=rollno_file,
                model_app=face_model,
                cosine_th=ML_CONFIG["COSINE_TH"],
                margin_th=ML_CONFIG["MARGIN_TH"],
                model_name="buffalo_l",
                top_k=ML_CONFIG["TOP_K"],
                img_exts=ML_CONFIG["IMG_EXTS"]
            )
            for v in results.values():
                if v != "UNKNOWN":
                    all_present_rolls.add(v)

        present_rolls = list(all_present_rolls)

        # Persist session with custom date
        new_sess = AttendanceSession(course_id=course.id, date=parsed_date)
        db.add(new_sess)
        db.flush()

        for roll in present_rolls:
            student = db.query(User).filter(User.roll_no == roll).first()
            if student:
                record = AttendanceRecord(session_id=new_sess.id, student_id=student.id)
                db.add(record)

        # Commit BEFORE returning so /sessions endpoint sees it immediately
        db.commit()
        db.refresh(new_sess)

        # Build full session snapshot so frontend can display it instantly
        total_students = db.query(User).filter(
            User.role == "student"
        ).join(User.courses).filter(Course.id == course.id).count()

        return {
            "session_id":      new_sess.id,
            "session_date":    session_date,
            "present_rolls":   present_rolls,
            "total_detected":  total_detected,
            "total_present":   len(present_rolls),
            "images_processed": len(files),
            # Extra fields for instant session-log update on the frontend
            "session_summary": {
                "session_id":      new_sess.id,
                "date":            new_sess.date.strftime("%Y-%m-%d"),
                "present":         len(present_rolls),
                "absent":          max(0, total_students - len(present_rolls)),
                "total":           total_students,
                "attendance_pct":  round(len(present_rolls) / total_students * 100, 1)
                                   if total_students else 0,
            },
        }

    finally:
        shutil.rmtree(session_dir, ignore_errors=True)


# --- Get all sessions for a course (attendance log) ---
@app.get("/api/professor/courses/{course_id}/sessions")
async def get_course_sessions(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    course = db.query(Course).filter(
        Course.id == course_id
    ).join(User.courses).filter(User.id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=403, detail="Not your course")

    sessions = db.query(AttendanceSession).filter(
        AttendanceSession.course_id == course_id
    ).order_by(AttendanceSession.date.desc()).all()

    total_students = db.query(User).filter(
        User.role == "student"
    ).join(User.courses).filter(Course.id == course_id).count()

    result = []
    for s in sessions:
        present_count = db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == s.id
        ).count()
        result.append({
            "session_id": s.id,
            "date": s.date.strftime("%Y-%m-%d"),
            "present": present_count,
            "absent": max(0, total_students - present_count),
            "total": total_students,
            "attendance_pct": round(present_count / total_students * 100, 1) if total_students else 0,
        })
    return result


# --- Get full session detail: who was present / absent ---
@app.get("/api/professor/sessions/{session_id}")
async def get_session_detail(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    session = db.query(AttendanceSession).filter(
        AttendanceSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    all_students = db.query(User).filter(
        User.role == "student"
    ).join(User.courses).filter(Course.id == session.course_id).all()

    present_ids = {
        r.student_id for r in
        db.query(AttendanceRecord).filter(AttendanceRecord.session_id == session_id).all()
    }

    present = [{"id": s.id, "username": s.username, "roll_no": s.roll_no}
               for s in all_students if s.id in present_ids]
    absent  = [{"id": s.id, "username": s.username, "roll_no": s.roll_no}
               for s in all_students if s.id not in present_ids]

    return {
        "session_id": session_id,
        "date": session.date.strftime("%Y-%m-%d"),
        "present": present,
        "absent": absent,
    }


# --- Weekly report: per-student attendance % for a course ---
@app.get("/api/professor/courses/{course_id}/report")
async def get_course_report(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    course = db.query(Course).filter(
        Course.id == course_id
    ).join(User.courses).filter(User.id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=403, detail="Not your course")

    total_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.course_id == course_id
    ).count()

    students = db.query(User).filter(
        User.role == "student"
    ).join(User.courses).filter(Course.id == course_id).all()

    report = []
    for s in students:
        attended = db.query(AttendanceRecord).filter(
            AttendanceRecord.student_id == s.id,
            AttendanceRecord.session.has(course_id=course_id)
        ).count()
        pct = round(attended / total_sessions * 100, 1) if total_sessions else 0
        report.append({
            "student_id": s.id,
            "username": s.username,
            "roll_no": s.roll_no,
            "attended": attended,
            "total": total_sessions,
            "pct": pct,
            "status": "AT_RISK" if pct < 75 else "OK",
        })

    report.sort(key=lambda x: x["pct"])
    return {
        "course_code": course.course_code,
        "total_sessions": total_sessions,
        "total_students": len(students),
        "students": report,
    }


# --- Manual override: toggle a student's presence in a session ---
class ToggleAttendanceBody(BaseModel):
    student_id: int
    present: bool

@app.patch("/api/professor/sessions/{session_id}/override")
async def override_attendance(
    session_id: int,
    body: ToggleAttendanceBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    existing = db.query(AttendanceRecord).filter(
        AttendanceRecord.session_id == session_id,
        AttendanceRecord.student_id == body.student_id
    ).first()

    if body.present and not existing:
        db.add(AttendanceRecord(session_id=session_id, student_id=body.student_id, status="MANUAL"))
        db.commit()
        return {"action": "marked_present"}
    elif not body.present and existing:
        db.delete(existing)
        db.commit()
        return {"action": "marked_absent"}
    return {"action": "no_change"}


# ============================================================
# PROFESSOR: Download session attendance as CSV
# ============================================================
import io
import csv
from fastapi.responses import StreamingResponse

@app.get("/api/professor/sessions/{session_id}/download-csv")
async def download_session_csv(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.role != "professor":
        raise HTTPException(status_code=403, detail="Forbidden")

    session = db.query(AttendanceSession).filter(
        AttendanceSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Verify prof owns this course
    course = db.query(Course).filter(
        Course.id == session.course_id
    ).join(User.courses).filter(User.id == current_user.id).first()
    if not course:
        raise HTTPException(status_code=403, detail="Not your course")

    # All students enrolled in the course
    all_students = db.query(User).filter(
        User.role == "student"
    ).join(User.courses).filter(Course.id == session.course_id).all()

    present_ids = {
        r.student_id for r in
        db.query(AttendanceRecord).filter(
            AttendanceRecord.session_id == session_id
        ).all()
    }

    # Build CSV in-memory
    output = io.StringIO()
    writer = csv.writer(output)

    # Header
    writer.writerow([
        "Roll No",
        "Username",
        "Status",
        "Course",
        "Date",
    ])

    session_date_str = session.date.strftime("%Y-%m-%d")
    for s in sorted(all_students, key=lambda x: (x.roll_no or x.username)):
        writer.writerow([
            s.roll_no or "",
            s.username,
            "P" if s.id in present_ids else "A",
            course.course_code,
            session_date_str,
        ])

    output.seek(0)
    filename = f"attendance_{course.course_code}_{session_date_str}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================
# STUDENT DASHBOARD ENDPOINTS
# ============================================================

@app.get("/api/student/overview")
async def student_overview(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns enrolled courses + attendance % + streak data for the student."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Forbidden")

    # Re-fetch user with fresh session to avoid stale relationship cache
    current_user = db.merge(current_user)
    db.refresh(current_user)

    courses_data = []
    overall_attended = 0
    overall_total = 0

    for course in current_user.courses:
        total = db.query(AttendanceSession).filter(
            AttendanceSession.course_id == course.id
        ).count()
        attended = db.query(AttendanceRecord).filter(
            AttendanceRecord.student_id == current_user.id,
            AttendanceRecord.session.has(course_id=course.id)
        ).count()
        pct = round(attended / total * 100, 1) if total else 0

        # Determine professor for this course
        professor = db.query(User).filter(
            User.role == "professor"
        ).join(User.courses).filter(Course.id == course.id).first()

        courses_data.append({
            "id": course.id,
            "course_code": course.course_code,
            "total_sessions": total,
            "attended": attended,
            "absent": total - attended,
            "pct": pct,
            "status": "AT_RISK" if (total > 0 and pct < 75) else "ON_TRACK",
            "professor": professor.username if professor else "Unassigned",
        })
        overall_attended += attended
        overall_total += total

    overall_pct = round(overall_attended / overall_total * 100, 1) if overall_total else 0

    return {
        "student": {
            "id": current_user.id,
            "username": current_user.username,
            "roll_no": current_user.roll_no or "",
            "email": current_user.email or "",
        },
        "summary": {
            "total_courses": len(current_user.courses),
            "overall_pct": overall_pct,
            "overall_attended": overall_attended,
            "overall_total": overall_total,
            "at_risk_count": sum(1 for c in courses_data if c["status"] == "AT_RISK"),
        },
        "courses": courses_data,
    }


@app.get("/api/student/courses/{course_id}/sessions")
async def student_course_sessions(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """All sessions for a course with the student's own attendance status per session."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Forbidden")

    # Verify student is enrolled in this course
    enrolled = any(c.id == course_id for c in current_user.courses)
    if not enrolled:
        raise HTTPException(status_code=403, detail="Not enrolled in this course")

    sessions = db.query(AttendanceSession).filter(
        AttendanceSession.course_id == course_id
    ).order_by(AttendanceSession.date.desc()).all()

    present_session_ids = {
        r.session_id for r in
        db.query(AttendanceRecord).filter(
            AttendanceRecord.student_id == current_user.id
        ).all()
    }

    result = []
    for s in sessions:
        result.append({
            "session_id": s.id,
            "date": s.date.strftime("%Y-%m-%d"),
            "status": "P" if s.id in present_session_ids else "A",
        })

    return result


@app.get("/api/student/courses/{course_id}/classmates")
async def student_classmates(
    course_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Returns classmates + their overall attendance % (no names — only roll numbers for privacy)."""
    if current_user.role != "student":
        raise HTTPException(status_code=403, detail="Forbidden")

    enrolled = any(c.id == course_id for c in current_user.courses)
    if not enrolled:
        raise HTTPException(status_code=403, detail="Not enrolled in this course")

    total_sessions = db.query(AttendanceSession).filter(
        AttendanceSession.course_id == course_id
    ).count()

    students = db.query(User).filter(
        User.role == "student"
    ).join(User.courses).filter(Course.id == course_id).all()

    result = []
    for s in students:
        attended = db.query(AttendanceRecord).filter(
            AttendanceRecord.student_id == s.id,
            AttendanceRecord.session.has(course_id=course_id)
        ).count()
        pct = round(attended / total_sessions * 100, 1) if total_sessions else 0
        result.append({
            "roll_no": s.roll_no or s.username,
            "attended": attended,
            "total": total_sessions,
            "pct": pct,
            "is_me": s.id == current_user.id,
        })

    result.sort(key=lambda x: x["pct"], reverse=True)
    return result
