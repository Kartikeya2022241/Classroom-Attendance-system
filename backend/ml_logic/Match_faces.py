import os
import cv2
import numpy as np
import pickle
import matplotlib.pyplot as plt
from insightface.app import FaceAnalysis
# from ml_logic.Global_variables import (
#     DB_PATH,
#     QUERY_PATH,
#     MODEL_NAME,
#     TOP_K,
#     EUCLIDEAN_THRESHOLD,
#     COSINE_THRESHOLD,
#     IMG_EXTS,
#     ROLLNO_FILE,
#     EMB_FILE,
#     app,
#     MARGIN
# )

from ml_logic.Get_embedding import get_embedding

def is_image_file(name: str,img_exts):
    return os.path.splitext(name)[1].lower() in img_exts

def normalize(v):
    v = np.asarray(v, dtype=np.float32)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else None



def find_db_image_for_rollno(db_path: str, rollno: str,img_exts):
    """Matches the ID back to the original image for display."""
    # Try multiple patterns
    patterns = [
        f"{rollno}_",
        f"{rollno}-",
        f"{rollno} ",
        rollno  # Exact match
    ]

    for pattern in patterns:
        for f in os.listdir(db_path):
            if f.startswith(pattern) and is_image_file(f,img_exts):
                return os.path.join(db_path, f)

    # Fallback: any file containing rollno
    for f in os.listdir(db_path):
        if rollno in f and is_image_file(f,img_exts):
            return os.path.join(db_path, f)

    return None

def show_query_and_match(query_fp, match_fp, title="", original_size=None, processed_size=None):
    # q = cv2.imread(query_fp)
    # m = cv2.imread(match_fp) if match_fp else None

    if original_size is not None:
        print(f"Query original: {original_size}, processed: {processed_size}")

    # fig, axes = plt.subplots(1, 2 if m is not None else 1, figsize=(10, 5))

    # # Show query
    # if m is not None:
    #     axes[0].imshow(cv2.cvtColor(q, cv2.COLOR_BGR2RGB))
    #     axes[0].set_title(f"Query ({q.shape[1]}x{q.shape[0]})")
    #     axes[0].axis("off")

    #     # Show match
    #     axes[1].imshow(cv2.cvtColor(m, cv2.COLOR_BGR2RGB))
    #     axes[1].set_title(f"Match: {title}")
    #     axes[1].axis("off")
    # else:
    #     axes.imshow(cv2.cvtColor(q, cv2.COLOR_BGR2RGB))
    #     axes.set_title(f"Query - No Match Found ({q.shape[1]}x{q.shape[0]})")
    #     axes.axis("off")

    # plt.tight_layout()
    # plt.show()
    # plt.close()



def topk_by_l2(bank: np.ndarray, q_emb: np.ndarray, k: int):
    """
    Vectorized L2 distances; returns indices of smallest K distances and their distances.
    """
    dists = np.linalg.norm(bank - q_emb, axis=1)
    k = min(k, len(dists))
    idx = np.argpartition(dists, kth=k-1)[:k]
    idx = idx[np.argsort(dists[idx])]
    return idx, dists[idx]

def run_queries(query_path, db_path, emb_file, rollno_file, model_app, cosine_th, margin_th,model_name,top_k,img_exts):
    # global app
    # global MARGIN

    with open(rollno_file, "rb") as f:
        rollno_map = pickle.load(f)
    bank = np.load(emb_file).astype(np.float32)


    results = {}
    q_files = [f for f in sorted(os.listdir(query_path)) if is_image_file(f,img_exts)]

    print(f"🔎 Running {len(q_files)} queries...")
    print(f"Database size: {len(rollno_map)} embeddings")
    print(f"Acceptance: cos >= {cosine_th} AND margin >= {margin_th}")
    avg_cosine = 0

    for i, file in enumerate(q_files, 1):
        fp = os.path.join(query_path, file)
        img = cv2.imread(fp)
        if img is None:
            results[file] = "UNKNOWN"
            print(f"❌ {file}: Cannot read image")
            continue

        # Show original size
        h, w = img.shape[:2]
        original_size = (w, h)

        q_emb = get_embedding(img,model_app,model_name)
        if q_emb is None:
            results[file] = "UNKNOWN"
            print(f"🔍 {file} ({w}x{h}) -> UNKNOWN (no embedding)")
            continue

        # Get processed size
        # processed_img = preprocess_lowres_face(img)
        processed_img = img
        processed_size = (processed_img.shape[1], processed_img.shape[0])

        # 1) Get Top-K by Euclidean (fast vectorized)
        idxs, l2s = topk_by_l2(bank, q_emb, top_k)

        # 2) Apply cosine on those K candidates (since vectors are normalized, cosine = dot)
        cosines = bank[idxs] @ q_emb

        # Find best and second-best cosine scores
        best_j = int(np.argmax(cosines))
        best_idx = int(idxs[best_j])
        best_l2 = float(l2s[best_j])
        best_cos = float(cosines[best_j])

        # Get second-best cosine (excluding the best one)
        second_best_cos = float(np.partition(cosines, -2)[-2]) if len(cosines) > 1 else -1.0

        # Calculate margin between best and second-best
        margin = best_cos - second_best_cos

        # Apply margin-based decision (same as second code)
        if best_cos >= cosine_th and margin >= margin_th:
            label = rollno_map[best_idx]
        else:
            label = "UNKNOWN"

        results[file] = label
        avg_cosine += best_cos

        # Create top K string for display
        topk_list = []
        for j in range(min(5, len(idxs))):
            idx_j = idxs[j]
            cos_j = cosines[j]
            l2_j = l2s[j]
            topk_list.append(f"{rollno_map[idx_j]}:{cos_j:.3f}")

        topk_str = ", ".join(topk_list)

        print(f"🔍 {file} ({w}x{h}) -> {label} | "
              f"best: {rollno_map[best_idx]} "
              f"(cos={best_cos:.3f}, 2nd={second_best_cos:.3f}, margin={margin:.3f}) | "
              f"top: {topk_str}")

        if label != "UNKNOWN":
            match_fp = find_db_image_for_rollno(db_path, label,img_exts)
            show_query_and_match(
                fp, match_fp,
                title=f"{label} (Cos:{best_cos:.2f}, margin:{margin:.2f})",
                original_size=original_size,
                processed_size=processed_size
            )
        elif i % 5 == 0:  # Show some unknowns too
            show_query_and_match(
                fp, None,
                original_size=original_size,
                processed_size=processed_size
            )

    if len(q_files) > 0:
        print(f"\n📊 Average cosine similarity: {avg_cosine/len(q_files):.3f}")

    return results, avg_cosine

# def main():

    
#     # Ensure model is initialized
#     global app

#     if app is None:
#         app = FaceAnalysis(name=MODEL_NAME, providers=['CPUExecutionProvider'])
#         app.prepare(ctx_id=0, det_size=(64, 64))
    
#     avg_cosine = 0


#     # all_results = {}
#     # all_avg_cosine = {}


#     # for file in os.listdir(QUERY_PATH):
#       # file_path = os.path.join(QUERY_PATH, file)
#       # print(file)
#     results, avg_cosine = run_queries(QUERY_PATH, DB_PATH, avg_cosine)
#       # all_results[file] = results
#       # all_avg_cosine[file]=avg_cosine

#       # Print summary
#     print("\n" + "="*50)
#     print("RESULTS SUMMARY:")
#     print("="*50)
#     recognized = sum(1 for v in results.values() if v != "UNKNOWN")
#     print(f"Recognized: {recognized}/{len(results)} ({recognized/len(results)*100:.1f}%)")

#     from Save_attendance_analyze import summarize_results, mark_attendance_from_results, evaluate_attendance, init_attendance_csv
#     from Global_variables import db_faces_path, attendance_csv, ground_truth_csv

#     init_attendance_csv(db_faces_path, attendance_csv)

#     summarize_results(results)

#     mark_attendance_from_results(results, attendance_csv)

#     evaluate_attendance(ground_truth_csv, attendance_csv, date_column="18 Feb")

#     if os.path.exists("attendance.csv"):
#         os.remove("attendance.csv")
#         print("Temporary attendance.csv file removed.")
    
#     if os.path.exists("detected_faces"):
#         import shutil
#         shutil.rmtree("detected_faces")
#         print("Temporary detected_faces directory removed.")



# if __name__ == "__main__":
#     main()
