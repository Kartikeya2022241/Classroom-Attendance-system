from insightface.app import FaceAnalysis
import insightface
import os
import cv2 
import numpy as np
import pickle

# from ml_logic.Global_variables import MODEL_NAME, app

def enhance_lowres_image(img_bgr):
    """
    Enhance low-resolution face images for better recognition.
    """
    if img_bgr is None:
        return None

    # Convert to YCrCb for better luminance enhancement
    ycrcb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycrcb)

    # CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    y_eq = clahe.apply(y)

    # Merge back
    ycrcb_eq = cv2.merge([y_eq, cr, cb])
    enhanced = cv2.cvtColor(ycrcb_eq, cv2.COLOR_YCrCb2BGR)

    # Gentle sharpening
    kernel = np.array([[-1,-1,-1],
                       [-1, 9,-1],
                       [-1,-1,-1]]) / 9.0
    enhanced = cv2.filter2D(enhanced, -1, kernel)

    return enhanced

def resize_for_insightface(img_bgr, min_size=20):
    """
    Ensure image meets minimum size requirements.
    """
    h, w = img_bgr.shape[:2]

    if h < min_size or w < min_size:
        # Calculate scale factor
        scale = max(min_size / h, min_size / w, 1.2)  # At least 20% upscale
        new_h, new_w = int(h * scale), int(w * scale)
        resized = cv2.resize(img_bgr, (new_w, new_h),
                            interpolation=cv2.INTER_CUBIC)
        return resized
    return img_bgr

def preprocess_lowres_face(img_bgr):
    """
    Complete preprocessing pipeline for low-res faces.
    """
    # Step 1: Ensure minimum size
    img_resized = resize_for_insightface(img_bgr, min_size=28)

    # Step 2: Enhance image quality
    img_enhanced = enhance_lowres_image(img_resized)
    img_enhanced = img_resized

    # Step 3: Add padding (helps with very small faces)
    h, w = img_enhanced.shape[:2]
    pad_h = max(0, 112 - h) // 2
    pad_w = max(0, 112 - w) // 2

    if pad_h > 0 or pad_w > 0:
        img_enhanced = cv2.copyMakeBorder(
            img_enhanced,
            pad_h, pad_h, pad_w, pad_w,
            cv2.BORDER_REPLICATE
        )

    return img_enhanced
    # return img_bgr

def get_embedding(img_bgr,model_app,model_name):
    """
    Returns L2-normalized embedding using InsightFace.
    """
    # global app

    if model_app is None:
        # Initialize InsightFace model
        model_app = FaceAnalysis(name=model_name, providers=['CPUExecutionProvider'])
        model_app.prepare(ctx_id=0, det_size=(64,64))  # Smaller detection size

    try:
        # Preprocess for low-res
        img_processed = preprocess_lowres_face(img_bgr)

        # Get face embedding
        faces = model_app.get(img_processed)

        if len(faces) == 0:
            # Try original image if processed version fails
            print("Preproces image")
            different_sizes = [(32,32),(128,128),(256,256),(160,160)]
            for i in different_sizes:
                model_app = FaceAnalysis(name=model_name, providers=['CPUExecutionProvider'])
                model_app.prepare(ctx_id=0, det_size=i)  # Smaller detection size
                # img_processed = preprocess_lowres_face(img_bgr)

                faces = model_app.get(img_bgr)
                if (len(faces) > 0):
                    break

            if len(faces) == 0:
                print("No face detected")

            model_app = FaceAnalysis(name=model_name, providers=['CPUExecutionProvider'])
            model_app.prepare(ctx_id=0, det_size=(64,64))  # Smaller detection size

        if len(faces) > 0:
            # InsightFace embeddings are already L2 normalized
            return faces[0].normed_embedding
        else:
            print("No embedding was generated")
            return None
    except Exception as e:
        print(f"Embedding extraction error: {e}")
        return None