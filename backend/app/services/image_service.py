"""Image processing service for screenshot handling."""
from PIL import Image
import io


class ImageService:
    """Handles image upload, validation, and preprocessing."""

    ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB

    def validate_image(self, content: bytes, content_type: str) -> bool:
        """Validate image type and size."""
        if content_type not in self.ALLOWED_TYPES:
            return False
        if len(content) > self.MAX_SIZE_BYTES:
            return False
        return True

    def preprocess(self, content: bytes) -> bytes:
        """Preprocess image for Claude Vision API."""
        img = Image.open(io.BytesIO(content))
        # Resize if too large (Claude has limits)
        max_dim = 2048
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
