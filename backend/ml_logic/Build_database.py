
from insightface.app import FaceAnalysis
import insightface
import os
import cv2 
import numpy as np
import pickle

from ml_logic.Get_embedding import get_embedding
# from ml_logic.Global_variables import MODEL_NAME, IMG_EXTS, EMB_FILE, ROLLNO_FILE, app



def is_image_file(name: str,img_exts):
    return os.path.splitext(name)[1].lower() in img_exts

def build_database(db_path: str, img_exts, model_name, emb_file, rollno_file, model_app=None):
    if not os.path.isdir(db_path):
        raise FileNotFoundError(db_path)

    # Initialize InsightFace if no model passed in
    if model_app is None:
        model_app = FaceAnalysis(name=model_name, providers=['CPUExecutionProvider'])
        model_app.prepare(ctx_id=0, det_size=(64, 64))

    rollno_map, embs = [], []
    files = [f for f in sorted(os.listdir(db_path)) if is_image_file(f,img_exts)]
    print(f"📦 Indexing {len(files)} DB face images...")
    print(f"Using model: {model_name}")

    for i, file in enumerate(files, 1):
        fp = os.path.join(db_path, file)
        img = cv2.imread(fp)
        if img is None:
            print(f"❌ Skipping {file}: Cannot read image")
            continue

        # Extract rollno
        rollno = os.path.splitext(file)[0].split('_')[0]

        # Show image size
        h, w = img.shape[:2]
        if h < 60 or w < 60:
            print(f"⚠️ Low-res DB image: {rollno} ({w}x{h})")

        emb = get_embedding(img, model_app, model_name)
        if emb is None:
            # Try without preprocessing
            try:
                faces = model_app.get(img)
                if len(faces) > 0:
                    emb = faces[0].normed_embedding
            except:
                pass

            if emb is None:
                print(f"❌ Failed embedding: {rollno}")
                continue

        rollno_map.append(rollno)
        embs.append(emb)

        if i % 10 == 0:
            print(f"✅ Indexed {i}/{len(files)}: {rollno}")

    if not embs:
        raise RuntimeError("No embeddings generated. Check DB images.")

    embs = np.vstack(embs).astype(np.float32)

    np.save(emb_file, embs)
    with open(rollno_file, "wb") as f:
        pickle.dump(rollno_map, f)

    print(f"✅ Saved embedding bank: {emb_file} ({embs.shape})")
    print(f"✅ Saved id map: {rollno_file} (n={len(rollno_map)})")
    return app


# if __name__ == "__main__":
#     from Global_variables import DB_PATH
#     build_database(DB_PATH)