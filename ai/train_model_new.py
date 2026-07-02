import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
import joblib

print("Loading dataset...")
train_df = pd.read_feather("dataset/train.feather")
metadata_df = pd.read_feather("dataset/building_metadata.feather")
weather_df = pd.read_feather("dataset/weather_train.feather")

print("Dataset shapes:", train_df.shape, metadata_df.shape, weather_df.shape)

train_df["timestamp"] = pd.to_datetime(train_df["timestamp"])
metadata_df["primary_use"] = metadata_df["primary_use"].fillna("Unknown")
metadata_df["square_feet"] = metadata_df["square_feet"].fillna(metadata_df["square_feet"].median())
metadata_df["year_built"] = metadata_df["year_built"].fillna(metadata_df["year_built"].median())
metadata_df["floor_count"] = metadata_df["floor_count"].fillna(-1)

train_df = train_df.merge(
    metadata_df[["building_id", "site_id", "primary_use", "square_feet", "year_built", "floor_count"]],
    on="building_id",
    how="left",
)

weather_df["timestamp"] = pd.to_datetime(weather_df["timestamp"]).dt.floor("H")
train_df["timestamp_hour"] = train_df["timestamp"].dt.floor("H")
train_df = train_df.merge(
    weather_df,
    left_on=["site_id", "timestamp_hour"],
    right_on=["site_id", "timestamp"],
    how="left",
    suffixes=("", "_weather"),
)

weather_cols = [
    "air_temperature",
    "cloud_coverage",
    "dew_temperature",
    "precip_depth_1_hr",
    "sea_level_pressure",
    "wind_speed",
]
for col in weather_cols:
    train_df[col] = train_df[col].fillna(train_df[col].median())

train_df["hour"] = train_df["timestamp"].dt.hour
train_df["day_of_week"] = train_df["timestamp"].dt.weekday
train_df["month"] = train_df["timestamp"].dt.month
train_df["is_weekend"] = (train_df["day_of_week"] >= 5).astype(int)

print("Building feature matrix...")
train_df = train_df.sample(n=100000, random_state=42)
print("Training sample shape:", train_df.shape)

feature_columns = [
    "building_id",
    "meter",
    "primary_use",
    "square_feet",
    "year_built",
    "floor_count",
    "hour",
    "day_of_week",
    "month",
    "is_weekend",
    "air_temperature",
    "cloud_coverage",
    "dew_temperature",
    "precip_depth_1_hr",
    "sea_level_pressure",
    "wind_speed",
]

categorical_features = ["meter", "primary_use", "hour", "day_of_week", "month", "is_weekend"]

X = train_df[feature_columns]
y = train_df["meter_reading"]

preprocessor = ColumnTransformer(
    transformers=[
        ("cat", OneHotEncoder(handle_unknown="ignore", sparse=False), categorical_features),
    ],
    remainder="passthrough",
)

pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        (
            "model",
            RandomForestRegressor(
                n_estimators=100,
                random_state=42,
                max_depth=12,
                min_samples_leaf=10,
                n_jobs=-1,
            ),
        ),
    ],
)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print("Training RandomForest model...")
pipeline.fit(X_train, y_train)
print("Training completed!")

predictions = pipeline.predict(X_test)
mae = mean_absolute_error(y_test, predictions)
rmse = mean_squared_error(y_test, predictions, squared=False)
r2 = r2_score(y_test, predictions)

print("\nModel Performance")
print("----------------------------")
print("Mean Absolute Error (MAE):", round(mae, 2))
print("Root Mean Squared Error (RMSE):", round(rmse, 2))
print("R² Score:", round(r2, 4))

joblib.dump(pipeline, "backend/energy_model.pkl")
print("\nModel saved successfully as backend/energy_model.pkl")

print("\nSample predictions:")
result = pd.DataFrame({
    "Actual": y_test.values[:10],
    "Predicted": predictions[:10],
})
print(result)
