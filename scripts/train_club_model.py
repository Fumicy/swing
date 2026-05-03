"""
Golf Club Head Detection — Google Colab Training Script
=======================================================
Run this notebook in Google Colab (GPU runtime recommended, T4 is fine).

Steps:
  1. Install dependencies
  2. Download dataset from Roboflow (golf-club-tracking v2, YOLOv8 format)
  3. Train YOLOv8n for 50 epochs at 320×320
  4. Export to ONNX (opset 12, simplified)
  5. Download the model → place at swingai/models/club_yolo8n.onnx

Expected result: ~45 mAP50 on validation set, <3 MB model file.

Roboflow dataset: https://universe.roboflow.com/club-head-tracking/golf-club-tracking
  Version 2 contains ~900 annotated frames, single class: club_head
  Sign up at roboflow.com (free tier) to get an API key.
"""

# ── Cell 1: Install ─────────────────────────────────────────────────────────
# !pip install ultralytics roboflow --quiet

# ── Cell 2: Download dataset ────────────────────────────────────────────────
# Replace YOUR_API_KEY with your Roboflow API key (free at roboflow.com)
ROBOFLOW_API_KEY = "YOUR_API_KEY"
WORKSPACE        = "club-head-tracking"
PROJECT          = "golf-club-tracking"
VERSION          = 2

"""
from roboflow import Roboflow

rf = Roboflow(api_key=ROBOFLOW_API_KEY)
project = rf.workspace(WORKSPACE).project(PROJECT)
dataset = project.version(VERSION).download("yolov8")
data_yaml = dataset.location + "/data.yaml"
print("Dataset location:", dataset.location)
"""

# ── Cell 3: Train ───────────────────────────────────────────────────────────
"""
from ultralytics import YOLO

model = YOLO("yolov8n.pt")
results = model.train(
    data=data_yaml,
    imgsz=320,
    epochs=50,
    batch=32,
    device=0,          # GPU
    project="golf_club",
    name="v1",
    exist_ok=True,
    # Augmentations that help with fast-moving objects:
    mosaic=0.5,
    hsv_h=0.015,
    hsv_s=0.4,
    hsv_v=0.3,
    fliplr=0.0,        # Do NOT flip — left/right matters for golf
    degrees=5.0,
)
print("Best weights:", results.save_dir + "/weights/best.pt")
"""

# ── Cell 4: Export to ONNX ──────────────────────────────────────────────────
"""
best_pt = results.save_dir + "/weights/best.pt"
export_model = YOLO(best_pt)
export_model.export(
    format="onnx",
    imgsz=320,
    simplify=True,
    opset=12,
    dynamic=False,
)
# Output: golf_club/v1/weights/best.onnx
import shutil, os
shutil.copy(
    best_pt.replace(".pt", ".onnx"),
    "/content/club_yolo8n.onnx"
)
print("ONNX model saved to /content/club_yolo8n.onnx")
"""

# ── Cell 5: Download ────────────────────────────────────────────────────────
"""
from google.colab import files
files.download("/content/club_yolo8n.onnx")
# Then place the downloaded file at:
#   swingai/models/club_yolo8n.onnx
"""

# ── Notes ────────────────────────────────────────────────────────────────────
# If the Roboflow dataset is unavailable, an alternative source:
#   https://universe.roboflow.com/golf-7dnhb/golf-club-detection-rfqub
#   (smaller, ~300 images, but freely browsable without login)
#
# Model output tensor layout (confirmed for YOLOv8 ONNX opset 12):
#   shape: [1, 5, 2100]  (4 box coords + 1 class)
#   access: d[(4+c) * numBoxes + i]
#
# To verify after export (run locally):
#   import onnxruntime as ort, numpy as np
#   sess = ort.InferenceSession("club_yolo8n.onnx")
#   print(sess.get_inputs()[0])   # should be images [1,3,320,320]
#   print(sess.get_outputs()[0])  # should be output0 [1, ?, 2100]
