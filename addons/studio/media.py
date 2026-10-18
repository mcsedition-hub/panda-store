"""Bounded local media inspection and encoding. No user strings become command syntax."""

import hashlib
import json
import math
import shutil
import subprocess
import time
from pathlib import Path

from PIL import ImageFont

MAX_UPLOAD = 25_000_000
MAX_DURATION = 120
MAX_OUTPUT = 60_000_000
WIDTH, HEIGHT, FPS = 1080, 1920, 30
FONT = Path(__file__).parent / "fonts" / "Ronzino-Regular.woff2"


class MediaError(Exception):
    pass


def available():
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe") and FONT.is_file())


def run(command, cwd, *, timeout=180, check=lambda: None):
    """Drain bounded stdout via a file; always stop the child on timeout/cancellation."""
    with (Path(cwd) / "command-output.txt").open("w+b") as output:
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                shell=False,
            )
        except FileNotFoundError:
            raise MediaError(
                "Install FFmpeg and ffprobe on the API and worker, then retry."
            ) from None
        start = time.monotonic()
        try:
            while process.poll() is None:
                check()
                if time.monotonic() - start > timeout or output.tell() > 1_000_000:
                    raise MediaError("Media processing exceeded its time or output limit.")
                time.sleep(0.1)
            check()
            if process.returncode:
                raise MediaError(
                    "This media could not be processed. Check its format and try again."
                )
            output.seek(0)
            return output.read(1_000_001)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def inspect(path, *, check=lambda: None):
    path = Path(path)
    output = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-max_alloc",
            "67108864",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            "mov,mp3,wav",
            "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name,width,height,duration,channels:stream_disposition=attached_pic",
            "-of",
            "json",
            path.name,
        ],
        path.parent,
        timeout=12,
        check=check,
    )
    try:
        data = json.loads(output)
        streams = data["streams"]
        if len(streams) > 4 or any(s["codec_type"] not in {"video", "audio"} for s in streams):
            raise ValueError()
        video = [s for s in streams if s["codec_type"] == "video"]
        audio = [s for s in streams if s["codec_type"] == "audio"]
        duration = float(data["format"]["duration"])
        if not math.isfinite(duration) or not 0.1 <= duration <= MAX_DURATION + 0.2:
            raise MediaError("Use a recording between 0.1 and 120 seconds.")
        if len(video) > 1 or len(audio) > 1 or not (video or audio):
            raise ValueError()
        if video:
            stream = video[0]
            width, height = int(stream["width"]), int(stream["height"])
            if stream["codec_name"] != "h264" or stream.get("disposition", {}).get("attached_pic"):
                raise MediaError(
                    "Export your recording as an MP4 with H.264 video before uploading."
                )
            if not (1 <= width <= 4096 and 1 <= height <= 4096 and width * height <= 8_847_360):
                raise MediaError("Use a recording no larger than 4K.")
            if "mov" not in data["format"]["format_name"].split(","):
                raise ValueError()
            kind, ext, mime = "video", "mp4", "video/mp4"
        else:
            width = height = 0
            codec = audio[0]["codec_name"]
            ext, mime = {
                "mp3": ("mp3", "audio/mpeg"),
                "aac": ("m4a", "audio/mp4"),
                "pcm_s16le": ("wav", "audio/wav"),
                "pcm_s24le": ("wav", "audio/wav"),
                "pcm_f32le": ("wav", "audio/wav"),
            }[codec]
            kind = "audio"
        if audio and (
            int(audio[0].get("channels", 0)) > 2
            or audio[0]["codec_name"] not in {"aac", "mp3", "pcm_s16le", "pcm_s24le", "pcm_f32le"}
        ):
            raise MediaError("Use mono or stereo AAC, MP3 or WAV audio.")
        return {
            "kind": kind,
            "extension": ext,
            "mime_type": mime,
            "duration": duration,
            "width": width,
            "height": height,
            "has_audio": bool(audio),
            "video_duration": float(video[0].get("duration", duration)) if video else None,
        }
    except (ValueError, KeyError, TypeError):
        raise MediaError(
            "Use H.264 MP4 video or a mono/stereo MP3, M4A or WAV recording."
        ) from None


def caption_lines(text):
    font = ImageFont.truetype(str(FONT), 54)
    lines = []
    for paragraph in text.splitlines():
        line = ""
        for char in paragraph:
            if ord(char) < 32:
                continue
            if font.getlength(line + char) > WIDTH * 0.80:
                # Prefer a word boundary, while retaining long words and literal punctuation.
                if " " in line:
                    before, after = line.rsplit(" ", 1)
                    lines.append(before)
                    line = after + char
                else:
                    lines.append(line)
                    line = char
            else:
                line += char
        lines.append(line)
    if len(lines) > 7:
        raise MediaError("Shorten the on-screen text to fit within seven lines.")
    return "\n".join(lines)


def ffmpeg():
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-max_alloc",
        "67108864",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]


def input_args(path, *, start=0, image=False):
    args = ["-protocol_whitelist", "file", "-threads", "2"]
    if image:
        args += ["-f", "image2", "-pattern_type", "none", "-loop", "1", "-framerate", str(FPS)]
    else:
        args += ["-format_whitelist", "mov,mp3,wav", "-ss", str(start)]
    return args + ["-i", Path(path).name]


def encode_shot(directory, scene, visual, voice, *, check=lambda: None):
    directory = Path(directory)
    image = visual["kind"] in {"store_screenshot", "image"}
    command = ffmpeg() + input_args(visual["path"], start=scene.get("video_start", 0), image=image)
    if voice:
        command += input_args(voice["path"], start=scene.get("audio_start", 0))
        audio = "1:a:0"
    elif scene.get("original_audio") and visual.get("has_audio"):
        audio = "0:a:0"
    else:
        command += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        audio = "1:a:0"
    filters = (
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:"
        f"force_divisible_by=2,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:"
        f"color=0x1b2021,setsar=1,fps={FPS},format=yuv420p"
    )
    if scene["caption"].strip():
        (directory / "caption.txt").write_text(caption_lines(scene["caption"]), encoding="utf-8")
        shutil.copyfile(FONT, directory / "font.woff2")
        filters += (
            ",drawtext=fontfile=font.woff2:textfile=caption.txt:expansion=none:"
            "fontsize=54:fontcolor=white:line_spacing=12:box=1:boxcolor=0x1b2021@0.88:"
            "boxborderw=20:x=(w-text_w)/2:y=h*0.91-text_h"
        )
    duration = scene["duration"]
    command += [
        "-map",
        "0:v:0",
        "-map",
        audio,
        "-vf",
        filters,
        "-af",
        f"aresample=48000,apad,atrim=duration={duration},asetpts=PTS-STARTPTS",
        "-t",
        str(duration),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        "4M",
        "-bufsize",
        "8M",
        "-threads",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        "-fs",
        str(MAX_OUTPUT),
        "shot.mp4",
    ]
    run(command, directory, timeout=300, check=check)
    path = directory / "shot.mp4"
    info = inspect(path, check=check)
    if (
        len(path.read_bytes()) >= MAX_OUTPUT
        or abs(info["duration"] - duration) > 0.15
        or abs(info["video_duration"] - duration) > 0.15
    ):
        raise MediaError("The recording ended before this shot. Adjust its start or duration.")
    return path.read_bytes()


def assemble(directory, parts, total, *, check=lambda: None):
    directory = Path(directory)
    for index, data in enumerate(parts):
        (directory / f"part-{index}.mp4").write_bytes(data)
    (directory / "parts.txt").write_text(
        "\n".join(f"file 'part-{i}.mp4'" for i in range(len(parts)))
    )
    command = ffmpeg() + [
        "-protocol_whitelist",
        "file",
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        "parts.txt",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-t",
        str(total),
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        "-fs",
        str(MAX_OUTPUT),
        "render.mp4",
    ]
    run(command, directory, timeout=120, check=check)
    path = directory / "render.mp4"
    info = inspect(path, check=check)
    data = path.read_bytes()
    if (
        len(data) >= MAX_OUTPUT
        or abs(info["duration"] - total) > 0.15
        or abs(info["video_duration"] - total) > 0.15
        or (info["width"], info["height"]) != (WIDTH, HEIGHT)
    ):
        raise MediaError("The rendered file failed its duration, size or dimensions check.")
    return data, {**info, "sha256": hashlib.sha256(data).hexdigest(), "fps": FPS}


def asset_suffix(asset):
    return {"video": "mp4", "audio": asset.metadata.get("extension", "mp3")}.get(
        asset.metadata.get("kind"), "jpg"
    )
