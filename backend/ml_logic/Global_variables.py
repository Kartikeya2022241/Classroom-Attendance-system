DB_PATH    = "All_Students_detected"
QUERY_PATH = "detected_faces"

# InsightFace model configuration
MODEL_NAME = "buffalo_l"  # or "buffalo_sc" for smaller model
TOP_K = 10

# Adjusted thresholds for low-res faces
EUCLIDEAN_THRESHOLD = 1.50  # Increased for low-res
COSINE_THRESHOLD    = 0.25  # Lowered for low-res
avg_cosine = 0
MARGIN = 0.06

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

ROLLNO_FILE     = "student_faces_rollno.pkl"
EMB_FILE        = "student_faces_embs.npy"

# InsightFace model instance (global for efficiency)
app = None

BOX_SHRINK = 0   # shrink bbox by 8% on each side

db_faces_path = "All_Students_detected"
attendance_csv = "attendance.csv"
ground_truth_csv = "DL_attendance_data - Sheet3.csv"
