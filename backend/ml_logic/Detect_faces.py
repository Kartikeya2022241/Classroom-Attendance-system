from retinaface import RetinaFace
import cv2
import os
import numpy as np
from PIL import Image
import pillow_heif

# from ml_logic.Global_variables import BOX_SHRINK
# Enable HEIC support
pillow_heif.register_heif_opener()



def load_image_any_format(img_path):
    if img_path.lower().endswith(".heic"):
        img = Image.open(img_path)
        img = np.array(img)
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    else:
        img = cv2.imread(img_path)
    return img


def safe_crop(img, x1, y1, x2, y2):
    # h, w = img.shape[:2]
    # x1 = max(0, min(x1, w - 1))
    # x2 = max(0, min(x2, w))
    # y1 = max(0, min(y1, h - 1))
    # y2 = max(0, min(y2, h))
    # if x2 <= x1 or y2 <= y1:
    #     return None
    return img[y1:y2, x1:x2]


def tighten_bbox(x1, y1, x2, y2, shrink):
    w = x2 - x1
    h = y2 - y1

    dx = int(w * shrink)
    dy = int(h * shrink)

    return (
        x1 + dx,
        y1 + dy,
        x2 - dx,
        y2 - dy
    )


def detect_and_save_faces(
    img_path,
    count,
    output_folder="detected_faces",
    conf_th=0.9,
    shrink=0
):
    os.makedirs(output_folder, exist_ok=True)

    img = load_image_any_format(img_path)
    if img is None:
        print(f"❌ Could not read {img_path}")
        return count

    faces = RetinaFace.detect_faces(img)
    if not faces:
        return count

    for _, face in faces.items():
        if face["score"] < conf_th:
            continue

        x1, y1, x2, y2 = map(int, face["facial_area"])

        # tighten bounding box to avoid nearby faces
        x1, y1, x2, y2 = tighten_bbox(x1, y1, x2, y2,shrink)

        face_crop = safe_crop(img, x1, y1, x2, y2)
        if face_crop is None or face_crop.size == 0:
            continue

        # ❌ NO RESIZING — save original crop size
        count += 1
        save_path = os.path.join(output_folder, f"face_{count}.png")
        cv2.imwrite(save_path, face_crop)

    print(f"{os.path.basename(img_path)} → total saved: {count}")
    return count


# ---------------- RUN ----------------


def main():
    path = "DL Project Data/18-02-2025"
    count = 0

    for file in sorted(os.listdir(path)):
        if not file.lower().endswith((".jpg", ".jpeg", ".png", ".heic")):
            continue
        file_path = os.path.join(path, file)
        count = detect_and_save_faces(file_path, count)

    print(f"✅ Total faces saved: {count}")


if __name__ == "__main__":
    main()




