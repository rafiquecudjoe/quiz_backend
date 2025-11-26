"""
Pydantic models for API requests and responses
"""
from pydantic import BaseModel
from typing import List, Dict, Optional


class BoundingBox(BaseModel):
    x: int
    y: int
    width: int
    height: int


class RegionInfo(BaseModel):
    bbox: BoundingBox
    area: int
    aspect_ratio: float


class DiagramAnalysis(BaseModel):
    diagram_type: str
    description: str
    key_elements: List[str] = []
    labels: List[str] = []
    is_recreatable: bool = False
    recreation_instructions: Optional[str] = None


class DiagramData(BaseModel):
    diagram_index: int
    bbox: BoundingBox
    image_path: str
    analysis: Optional[DiagramAnalysis] = None


class PageRegions(BaseModel):
    text_blocks: List[RegionInfo]
    diagram_blocks: List[RegionInfo]
    mixed_blocks: List[RegionInfo]


class PageData(BaseModel):
    page_number: int
    page_image_path: str
    regions: PageRegions
    diagrams: List[DiagramData] = []
    ai_processed: bool = False


class ProcessingResponse(BaseModel):
    job_id: str
    status: str
    message: str


class ResultResponse(BaseModel):
    document_info: Dict
    pages: List[Dict]


class HealthResponse(BaseModel):
    status: str
    version: str
