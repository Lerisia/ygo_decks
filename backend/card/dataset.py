import requests
from io import BytesIO
from PIL import Image
import torch
import pandas as pd
from torch.utils.data import Dataset
from torchvision import transforms
import os
import re
import numpy as np

class CardDataset(Dataset):
    def __init__(self, csv_path, transform=None, download_dir="data/"):
        self.data = pd.read_csv(csv_path)
        self.data["Image URL"] = self.data["Image URL"].astype(str).str.strip()
        self.data = self.data[~self.data["Image URL"].str.contains(r"^\(None,\)$", na=False)]
        self.data["Image URL"] = self.data["Image URL"].apply(lambda x: re.sub(r"^\('(.+)',\)$", r"\1", x))
        self.data = self.data[~self.data["Image URL"].str.lower().isin(["none", "nan", "null", ""])]
        self.transform = transform
        self.download_dir = download_dir
        os.makedirs(download_dir, exist_ok=True)
        self.id_to_label = {id_: idx for idx, id_ in enumerate(sorted(self.data["ID"].unique()))}

    def __len__(self):
        return len(self.data)

    def clean_url(self, url):
        url = url.strip() 
        url = re.sub(r'^[("\',]+|[)"\',]+$', '', url)
        return url

    def download_image(self, url, filename):
        filepath = os.path.join(self.download_dir, filename)

        if not os.path.exists(filepath):
            try:
                url = self.clean_url(url)

                response = requests.get(url, timeout=5)
                response.raise_for_status()
                with open(filepath, "wb") as f:
                    f.write(response.content)
            except requests.exceptions.RequestException as e:
                print(f"이미지 다운로드 실패: {url}, 오류: {e}")
                return None
        return filepath

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        row = self.data.iloc[idx]
        img_url = row["Image URL"]
        img_filename = f"{row['ID']}.jpg"
        img_path = self.download_image(img_url, img_filename)

        if img_path is None:
            return None

        image = Image.open(img_path).convert("RGB")
        
        if self.transform:
            image = np.array(image)  # PIL → np.ndarray
            image = self.transform(image=image)["image"]  # Albumentations → tensor

        return image, self.id_to_label[row["ID"]]
