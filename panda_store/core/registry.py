"""A deployment-time registry shared by bundled and third-party modules.

Only packages explicitly selected by the administrator are imported. Manifests
are data, never arbitrary code from a workspace or an HTTP request.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from packaging.specifiers import InvalidSpecifier, SpecifierSet
from packaging.version import InvalidVersion, Version


@dataclass(frozen=True)
class Module:
    id: str
    name: str
    version: str
    core: str
    depends: dict[str, str]
    capabilities: tuple[str, ...]
    family: str
    icon: str
    description: str
    package: str
    required: bool = False
    availability: str = "available"

    @classmethod
    def parse(cls, raw, package):
        try:
            if not isinstance(raw, dict):
                raise ValueError("manifest must be an object")
            for field in ("name", "description"):
                if not isinstance(raw[field], str) or not raw[field].strip():
                    raise ValueError(f"{field} must be a non-empty string")
            if not isinstance(raw.get("required", False), bool):
                raise ValueError("required must be a boolean")
            if raw.get("availability", "available") not in {"available", "planned"}:
                raise ValueError("Invalid module availability")
            if raw.get("required") and raw.get("availability") == "planned":
                raise ValueError("A required module must be available")
            if not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", raw["id"]):
                raise ValueError("Invalid module id")
            Version(raw["version"])
            SpecifierSet(raw["core"])
            if not isinstance(raw.get("depends", {}), dict):
                raise ValueError("depends must map module ids to version constraints")
            for dependency, version in raw.get("depends", {}).items():
                if not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", dependency):
                    raise ValueError("Invalid dependency id")
                SpecifierSet(version)
            if raw["family"] not in {"frost", "coral", "lichen"}:
                raise ValueError("Invalid color family")
            if not isinstance(raw.get("capabilities", []), list):
                raise ValueError("capabilities must be a list")
            if any(not isinstance(c, str) or not c for c in raw.get("capabilities", [])):
                raise ValueError("capabilities must contain non-empty strings")
            icon = raw.get("icon", "extensions")
            if not re.fullmatch(r"[a-z-]+", icon):
                raise ValueError("Invalid icon name")
            return cls(
                id=raw["id"],
                name=raw["name"],
                version=raw["version"],
                core=raw["core"],
                depends=raw.get("depends", {}),
                capabilities=tuple(raw.get("capabilities", [])),
                family=raw["family"],
                icon=icon,
                description=raw["description"],
                package=package,
                required=raw.get("required", False),
                availability=raw.get("availability", "available"),
            )
        except (KeyError, TypeError, ValueError, InvalidSpecifier, InvalidVersion) as exc:
            raise ImproperlyConfigured(f"Invalid manifest in {package}: {exc}") from exc


class ModuleRegistry:
    def __init__(self, modules, core_version):
        modules = tuple(modules)
        self.modules = {}
        for module in modules:
            if module.id in self.modules:
                raise ImproperlyConfigured(f"Duplicate module id: {module.id}")
            if Version(core_version) not in SpecifierSet(module.core):
                raise ImproperlyConfigured(f"Incompatible core version: {module.id}")
            self.modules[module.id] = module
        for module in modules:
            for dependency, constraint in module.depends.items():
                target = self.modules.get(dependency)
                if target is None or Version(target.version) not in SpecifierSet(constraint):
                    raise ImproperlyConfigured(f"Unmet dependency {dependency} for {module.id}")
        self.order = self.resolve(self.modules)

    def resolve(self, selected):
        ordered, visiting, visited = [], set(), set()

        def visit(module_id):
            if module_id not in self.modules:
                raise ValueError(f"Unknown module: {module_id}")
            if module_id in visiting:
                raise ImproperlyConfigured(f"Cyclic module dependency: {module_id}")
            if module_id in visited:
                return
            visiting.add(module_id)
            for dependency in self.modules[module_id].depends:
                visit(dependency)
            visiting.remove(module_id)
            visited.add(module_id)
            ordered.append(module_id)

        for module_id in selected:
            visit(module_id)
        return tuple(ordered)


@lru_cache(maxsize=1)
def get_registry():
    modules = []
    for package in settings.PANDA_MODULE_PACKAGES:
        try:
            raw = json.loads(files(package).joinpath("module.json").read_text())
        except (OSError, ValueError, ModuleNotFoundError) as exc:
            raise ImproperlyConfigured(f"Cannot load module manifest: {package}") from exc
        modules.append(Module.parse(raw, package))
    return ModuleRegistry(modules, settings.PANDA_CORE_VERSION)
