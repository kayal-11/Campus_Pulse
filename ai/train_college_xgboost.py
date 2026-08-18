import os
from pathlib import Path
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
import joblib

def main():
    print("Loading college dataset from dataset/college_energy_data.xlsx...")
    file_path = Path("dataset/college_energy_data.xlsx")
    if not file_path.exists():
        file_path = Path("../dataset/college_energy_data.xlsx")
    
    df = pd.read_excel(file_path, header=None)
    
    # Rows 5 to 35 contain daily data for July 2026
    data_rows = df.iloc[5:36].copy()
    
    dates = pd.to_datetime(data_rows[1], format="%d.%m.%Y")
    
    # Extract readings per department
    admin_kwh = data_rows[4].astype(float).values
    chemi_kwh = data_rows[7].astype(float).values
    
    ece_fwd = data_rows[10].astype(float).values
    ece_rev = data_rows[13].astype(float).values
    ece_solar = data_rows[14].astype(float).values
    # Total ECE consumption = FWD + SOLAR - REV (matching Col 15)
    ece_total = ece_fwd + ece_solar - ece_rev
    
    records = []
    for idx, d in enumerate(dates):
        records.append({"date": d, "building": "ADMIN", "kwh": admin_kwh[idx]})
        records.append({"date": d, "building": "CHEMI", "kwh": chemi_kwh[idx]})
        records.append({"date": d, "building": "ECE", "kwh": ece_total[idx]})
    
    dataset = pd.DataFrame(records).sort_values(["building", "date"]).reset_index(drop=True)
    
    # Feature Engineering
    dataset["day_of_week"] = dataset["date"].dt.dayofweek
    dataset["day_of_month"] = dataset["date"].dt.day
    dataset["is_weekend"] = (dataset["day_of_week"] >= 5).astype(int)
    
    # Lags & rolling windows per building
    dataset["lag_1"] = dataset.groupby("building")["kwh"].shift(1)
    dataset["lag_2"] = dataset.groupby("building")["kwh"].shift(2)
    dataset["rolling_mean_3"] = dataset.groupby("building")["kwh"].shift(1).rolling(3, min_periods=1).mean()
    dataset["rolling_mean_7"] = dataset.groupby("building")["kwh"].shift(1).rolling(7, min_periods=1).mean()
    
    # Backfill and forward fill lag NAs
    for col in ["lag_1", "lag_2", "rolling_mean_3", "rolling_mean_7"]:
        dataset[col] = dataset.groupby("building")[col].transform(lambda x: x.bfill().ffill())
    
    # One-hot encoding for known buildings
    building_dummies = pd.get_dummies(dataset["building"], prefix="bldg", dtype=float)
    
    feature_columns = list(building_dummies.columns) + [
        "day_of_week",
        "day_of_month",
        "is_weekend",
        "lag_1",
        "lag_2",
        "rolling_mean_3",
        "rolling_mean_7",
    ]
    
    X = pd.concat([building_dummies, dataset[["day_of_week", "day_of_month", "is_weekend", "lag_1", "lag_2", "rolling_mean_3", "rolling_mean_7"]]], axis=1)
    y = dataset["kwh"]
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print(f"Training XGBoost Regressor on {len(X_train)} samples, testing on {len(X_test)} samples...")
    model = xgb.XGBRegressor(
        n_estimators=50,
        max_depth=3,
        learning_rate=0.1,
        random_state=42,
        objective="reg:squarederror",
    )
    model.fit(X_train, y_train)
    
    predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, predictions)
    rmse = np.sqrt(mean_squared_error(y_test, predictions))
    r2 = r2_score(y_test, predictions)
    
    print("\n-----------------------------------------")
    print("Campus XGBoost Model Performance Evaluation")
    print("-----------------------------------------")
    print(f"Mean Absolute Error (MAE):     {mae:.2f} kWh")
    print(f"Root Mean Squared Error (RMSE): {rmse:.2f} kWh")
    print(f"R² Score:                      {r2:.4f}")
    print("-----------------------------------------\n")
    
    artifact_payload = {
        "model": model,
        "feature_columns": feature_columns,
        "metrics": {
            "mae": float(round(mae, 2)),
            "rmse": float(round(rmse, 2)),
            "r2": float(round(r2, 4)),
        },
    }
    
    save_path = Path(__file__).resolve().parent.parent / "backend" / "campus_energy_xgboost.pkl"
    save_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact_payload, save_path)
    print(f"Campus XGBoost model saved successfully as {save_path}")


if __name__ == "__main__":
    main()
