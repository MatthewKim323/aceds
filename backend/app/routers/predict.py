from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models.schemas import PredictRequest, PredictResponse

router = APIRouter(prefix="/predict", tags=["ml"])


@router.post("", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    try:
        from ..ml.predictor import predict_sections
    except ImportError as e:  # model not trained yet
        raise HTTPException(status_code=503, detail=f"predictor unavailable: {e}")
    return predict_sections(req)
