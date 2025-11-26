"""
Configuration settings using pydantic-settings
"""
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    """Application settings"""
    
    # DeepSeek API
    deepseek_api_key: str
    deepseek_api_base: str = "https://api.deepseek.com/v1"
    
    # Google Gemini API (for vision OCR)
    gemini_api_key: str = ""
    
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    
    # File storage
    upload_dir: Path = Path("./uploads")
    output_dir: Path = Path("./output")
    max_file_size: int = 50_000_000  # 50MB
    
    class Config:
        env_file = ".env"
        case_sensitive = False


# Create global settings instance
settings = Settings()
