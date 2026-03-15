# =========================
# Attendance Pipeline
# =========================

import os
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix
)

# =========================
# 1. Initialize Attendance CSV
# =========================

def init_attendance_csv(db_faces_path: str, csv_path: str = "attendance.csv"):
    """
    Initializes attendance.csv with all students marked Absent (A)
    based on face database filenames.
    """
    rollnos = []

    for f in os.listdir(db_faces_path):
        if f.lower().endswith((".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp")):
            rollno = os.path.splitext(f)[0]
            rollno = rollno.split("_")[0].lower()
            rollnos.append(rollno)

    rollnos = sorted(set(rollnos))
    df = pd.DataFrame({"Roll No": rollnos, "status": ["A"] * len(rollnos)})
    df.to_csv(csv_path, index=False)

    print(f"✅ Initialized {csv_path} with {len(df)} students (all marked A).")


# =========================
# 2. Mark Attendance From Recognition Results
# =========================

def mark_attendance_from_results(results: dict, csv_path: str = "attendance.csv"):
    """
    Updates attendance.csv using face recognition results.
    """
    df = pd.read_csv(csv_path)

    # Extract unique present roll numbers (ignore UNKNOWN)
    present_rollnos = sorted({
        v.split("_")[0]
        for v in results.values()
        if v != "UNKNOWN" and pd.notna(v)
    })

    print(f"Students present: {present_rollnos}")

    df["status"] = df["Roll No"].astype(str).apply(
        lambda r: "P" if r in present_rollnos else "A"
    )

    df = df.sort_values("Roll No").reset_index(drop=True)
    df.to_csv(csv_path, index=False)

    print(f"✅ Attendance updated → P={len(present_rollnos)}, A={len(df)-len(present_rollnos)}")
    return df


# =========================
# 3. Result Distribution Helper
# =========================

def summarize_results(results: dict):
    """
    Prints frequency of predicted identities.
    """
    stats = {}
    for _, value in results.items():
        stats[value] = stats.get(value, 0) + 1

    stats = dict(sorted(stats.items(), key=lambda x: x[1], reverse=True))
    print("Prediction distribution:")
    print(stats)
    return stats


# =========================
# 4. Evaluation Against Ground Truth
# =========================

def evaluate_attendance(
    ground_truth_csv: str,
    pred_csv: str,
    date_column: str = "4 Feb"
):
    """
    Evaluates predicted attendance against ground truth.
    """
    df_true = pd.read_csv(ground_truth_csv)
    df_pred = pd.read_csv(pred_csv)

    # Normalize roll numbers
    df_true["Roll No"] = df_true["Roll No"].astype(str).str.lower()
    df_pred["Roll No"] = df_pred["Roll No"].astype(str).str.lower()

    df_true = df_true.sort_values("Roll No").reset_index(drop=True)
    df_pred = df_pred.sort_values("Roll No").reset_index(drop=True)

    # Merge
    df = pd.merge(
        df_true[["Roll No", date_column]],
        df_pred[["Roll No", "status"]],
        on="Roll No",
        how="inner",
        suffixes=("_true", "_pred")
    )

    df["true"] = df[f"{date_column}"].map({"P": 1, "A": 0})
    df["pred"] = df["status"].map({"P": 1, "A": 0})

    y_true = df["true"]
    y_pred = df["pred"]

    # Metrics
    accuracy = accuracy_score(y_true, y_pred)
    precision = precision_score(y_true, y_pred)
    recall = recall_score(y_true, y_pred)
    f1 = f1_score(y_true, y_pred)
    cm = confusion_matrix(y_true, y_pred)

    TN, FP, FN, TP = cm.ravel()
    FAR = FP / (FP + TN) if (FP + TN) > 0 else 0
    FRR = FN / (FN + TP) if (FN + TP) > 0 else 0

    print("\n📊 Evaluation Metrics")
    print("Accuracy :", accuracy)
    print("Precision:", precision)
    print("Recall   :", recall)
    print("F1 Score :", f1)
    print("Confusion Matrix:\n", cm)
    print("FAR:", FAR)
    print("FRR:", FRR)

    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "FAR": FAR,
        "FRR": FRR,
        "confusion_matrix": cm
    }


# =========================
# 5. Example Main Execution
# =========================

# if __name__ == "__main__":

    # Example variables (already computed in your pipeline)
    # results = {...}
    # avg_cosine = ...
    # len_results = len(results)

    # print(avg_cosine / len_results)

    
    # from Global_variables import db_faces_path, attendance_csv
    # Step 1: Initialize attendance
    # init_attendance_csv(db_faces_path, attendance_csv)

    

    # Step 2: Summarize recognition results
    # summarize_results(results)

    # Step 3: Mark attendance
    # mark_attendance_from_results(results, attendance_csv)

    # Step 4: Evaluate
    # evaluate_attendance(ground_truth_csv, attendance_csv)
