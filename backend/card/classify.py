import torch
from torchvision import transforms
from torchvision.models import resnet50, ResNet50_Weights
from PIL import Image
from io import BytesIO
from .dataset import CardDataset
import os
import torch.nn as nn

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

class ResNetClassifier(nn.Module):
    def __init__(self, num_classes):
        super(ResNetClassifier, self).__init__()
        self.resnet = resnet50(weights=ResNet50_Weights.DEFAULT)
        in_features = self.resnet.fc.in_features  
        self.resnet.fc = nn.Sequential(
            nn.Dropout(0.3),  # 🔥 Fully Connected Layer에 Dropout 추가
            nn.Linear(in_features, num_classes)
        )

    def forward(self, x):
        return self.resnet(x)
    

transform = transforms.Compose([
    transforms.Resize((64, 64)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])

BASE_DIR = os.path.dirname(__file__)
CSV_PATH = os.path.join(BASE_DIR, "cards.csv")
dataset = CardDataset(csv_path=CSV_PATH, transform=transform)
num_classes = len(dataset.id_to_label)
index_to_id = {v: k for k, v in dataset.id_to_label.items()}

model = ResNetClassifier(num_classes=num_classes).to(device)
PTH_PATH = os.path.join(BASE_DIR, "best_model.pth")
model.load_state_dict(torch.load(PTH_PATH, map_location=device))
model.eval()

def predict_card_from_bytes(image_bytes: bytes, topk: int = 5) -> tuple[str, float]:
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    input_tensor = transform(image).unsqueeze(0).to(device)

    with torch.no_grad():
        outputs = model(input_tensor)
        probs = torch.softmax(outputs, dim=1)
        top_prob, top_idx = probs.topk(1, dim=1)

    index = top_idx.item()
    confidence = top_prob.item()
    card_id = index_to_id.get(index, "Unknown")

    return card_id, confidence