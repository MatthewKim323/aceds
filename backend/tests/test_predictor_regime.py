from __future__ import annotations

from app.ml.predictor import regime_residual_rmse


def test_regime_residual_rmse_warm_matches_eval_table() -> None:
    assert abs(regime_residual_rmse("warm") - 0.219) < 1e-9


def test_regime_cold_both_wider_than_warm() -> None:
    assert regime_residual_rmse("cold_both") > regime_residual_rmse("warm")


def test_regime_unknown_falls_back_to_warm() -> None:
    assert regime_residual_rmse("not_a_regime") == regime_residual_rmse("warm")
