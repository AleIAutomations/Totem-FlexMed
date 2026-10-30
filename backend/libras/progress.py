# =============================================================================
# FlexMed LibrasFlow — terminal progress utilities
# =============================================================================

from __future__ import annotations

import sys
import time
from dataclasses import dataclass


def format_seconds(seconds: float | None) -> str:
    if seconds is None or seconds == float("inf") or seconds < 0:
        return "--:--"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


@dataclass
class ProgressMeter:
    total: int
    label: str = "progresso"
    every: int = 1

    def __post_init__(self) -> None:
        self.total = max(int(self.total or 0), 0)
        self.every = max(int(self.every or 1), 1)
        self.start = time.time()
        self.last = 0
        if self.total:
            print(f"[{self.label}] iniciado: {self.total} item(ns)")
        else:
            print(f"[{self.label}] iniciado")

    def update(self, current: int, detail: str = "") -> None:
        current = min(max(int(current), 0), self.total or int(current))
        if current != self.total and current - self.last < self.every:
            return
        self.last = current
        elapsed = time.time() - self.start
        if self.total and current:
            rate = current / max(elapsed, 1e-9)
            eta = (self.total - current) / rate if rate > 0 else None
            pct = current / self.total * 100
            msg = f"[{self.label}] {current}/{self.total} ({pct:5.1f}%) | decorrido {format_seconds(elapsed)} | ETA {format_seconds(eta)}"
        else:
            msg = f"[{self.label}] {current} item(ns) | decorrido {format_seconds(elapsed)}"
        if detail:
            msg += f" | {detail}"
        print(msg, flush=True)

    def done(self, detail: str = "") -> None:
        elapsed = time.time() - self.start
        msg = f"[{self.label}] concluído em {format_seconds(elapsed)}"
        if detail:
            msg += f" | {detail}"
        print(msg, flush=True)


try:
    from tensorflow.keras.callbacks import Callback as _KerasCallback
except Exception:  # TensorFlow ausente: scripts de coleta não precisam dele
    _KerasCallback = object


class KerasProgressCallback(_KerasCallback):
    """Keras callback that prints epoch progress with ETA without requiring tqdm."""

    def __init__(self, epochs: int, label: str):
        super().__init__()
        self.epochs = int(epochs)
        self.meter = ProgressMeter(self.epochs, label=label, every=1)

    def on_epoch_end(self, epoch, logs=None):  # Keras callback protocol
        logs = logs or {}
        detail = " | ".join(
            f"{k}={v:.4f}" for k, v in logs.items() if isinstance(v, (int, float))
        )
        self.meter.update(epoch + 1, detail)

    def on_train_end(self, logs=None):
        self.meter.done()
