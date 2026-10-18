"""Bound aggregate multipart uploads before Django writes them to temporary files."""

from django.core.files.uploadhandler import FileUploadHandler, StopUpload

MAX_FILE_BYTES = 25_000_000


class BoundedUploadHandler(FileUploadHandler):
    def __init__(self, request=None):
        super().__init__(request)
        self.received = 0

    def receive_data_chunk(self, raw_data, start):
        self.received += len(raw_data)
        if self.received > MAX_FILE_BYTES:
            raise StopUpload(connection_reset=True)
        return raw_data

    def file_complete(self, file_size):
        return None
