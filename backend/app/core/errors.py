from __future__ import annotations


class GDError(Exception):
    """A domain error with a stable machine-readable ``code`` (sent to REST and WS clients)."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def as_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}

