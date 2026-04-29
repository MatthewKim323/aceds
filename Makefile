# ACE — single entrypoints for DS / ML artifacts (repo root).
.PHONY: ds-train ds-conformal ds-plots ds-decision-eval ds-artifacts

ds-train:
	cd data_pipeline && python scripts/13_xgboost.py

ds-conformal:
	cd data_pipeline && python scripts/21_conformal_calibration.py

ds-plots:
	python data_pipeline/scripts/20_ablation_plots.py
	python data_pipeline/scripts/22_regime_reliability.py
	python data_pipeline/scripts/24_showcase_improvement_charts.py

ds-decision-eval:
	PYTHONPATH=backend python data_pipeline/scripts/23_decision_eval_synthetic.py

# Typical refresh after retraining: conformal + copy is handled inside 21.
ds-artifacts: ds-train ds-conformal ds-plots ds-decision-eval
	@echo "Copy processed/xgb_model.json and xgb_feature_cols.json to backend/app/ml/artifacts/ if you trained in data_pipeline/processed/ only."
