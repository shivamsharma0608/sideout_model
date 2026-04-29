import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import make_scorer, roc_auc_score, log_loss

# ── 1. Load ────────────────────────────────────────────────────────────────────
df = pd.read_csv("sideout_clean.csv")

# ── 2. Feature engineering ─────────────────────────────────────────────────────
PASS_ORDER = {"Error": 0, "Poor": 1, "Negative": 2, "OK": 3, "Positive": 4, "Perfect": 5}
df["pass_quality_ord"] = df["pass_quality"].map(PASS_ORDER)

def simplify_serve(s):
    if pd.isna(s):
        return "Other"
    s = s.lower()
    if "jump-float" in s or "jump float" in s:
        return "Jump-float"
    if "jump" in s:
        return "Jump"
    if "float" in s:
        return "Float"
    if "topspin" in s:
        return "Topspin"
    return "Other"

df["serve_cat"] = df["serve_type"].apply(simplify_serve)
serve_dummies = pd.get_dummies(df["serve_cat"], prefix="serve", drop_first=True)

df["late_set"] = ((df["receiving_team_score"] >= 20) | (df["serving_team_score"] >= 20)).astype(int)

FEATURES = ["pass_quality_ord", "late_set", "set_number", "receiving_setter_position", "score_diff"]
X = pd.concat([df[FEATURES], serve_dummies], axis=1).fillna(df[FEATURES].median())
y = df["sideout"].astype(int)

feature_cols = X.columns.tolist()

# ── 3. Cross-validation ────────────────────────────────────────────────────────
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

scorers = {
    "roc_auc": "roc_auc",
    "neg_log_loss": "neg_log_loss",
}

gb = GradientBoostingClassifier(n_estimators=200, max_depth=4, learning_rate=0.05, random_state=42)
lr = Pipeline([
    ("scaler", StandardScaler()),
    ("clf", LogisticRegression(max_iter=1000, random_state=42)),
])

print("=== 5-Fold Stratified CV ===\n")
for name, model in [("GradientBoosting", gb), ("LogisticRegression", lr)]:
    results = cross_validate(model, X, y, cv=cv, scoring=scorers, n_jobs=-1)
    auc  = results["test_roc_auc"].mean()
    ll   = -results["test_neg_log_loss"].mean()
    print(f"{name:<22}  AUC-ROC: {auc:.4f}   Log-Loss: {ll:.4f}")

# ── 4. Fit best model on full data ─────────────────────────────────────────────
# Use GradientBoosting if its AUC is higher; re-evaluate both cleanly here
gb_results = cross_validate(gb, X, y, cv=cv, scoring=scorers, n_jobs=-1)
lr_results = cross_validate(lr, X, y, cv=cv, scoring=scorers, n_jobs=-1)

gb_auc = gb_results["test_roc_auc"].mean()
lr_auc = lr_results["test_roc_auc"].mean()

best_name, best_model = ("GradientBoosting", gb) if gb_auc >= lr_auc else ("LogisticRegression", lr)
print(f"\nBest model: {best_name} (AUC {max(gb_auc, lr_auc):.4f})")

best_model.fit(X, y)
df["pred_prob"] = best_model.predict_proba(X)[:, 1]

# ── 5. Aggregate by player ─────────────────────────────────────────────────────
summary = (
    df.groupby(["player_id", "player_name"])
    .agg(
        receptions       =("sideout", "count"),
        actual_sideout   =("sideout", "mean"),
        expected_sideout =("pred_prob", "mean"),
    )
    .reset_index()
)
summary["value_above_expected"] = summary["actual_sideout"] - summary["expected_sideout"]

# ── 6. Filter and sort ─────────────────────────────────────────────────────────
summary = summary[summary["receptions"] >= 50].sort_values("value_above_expected", ascending=False)

# ── 7. Save ────────────────────────────────────────────────────────────────────
summary.to_csv("player_sideout_summary.csv", index=False)
print("\nSaved: player_sideout_summary.csv")

# ── 8. Top / bottom 10 ────────────────────────────────────────────────────────
pd.set_option("display.float_format", "{:.4f}".format)
pd.set_option("display.max_columns", 10)
pd.set_option("display.width", 120)

print("\n=== Top 10 Players (Value Above Expected) ===")
print(summary.head(10).to_string(index=False))

print("\n=== Bottom 10 Players (Value Above Expected) ===")
print(summary.tail(10).to_string(index=False))
