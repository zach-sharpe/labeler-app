"""Configuration management for labeler applications.

This module provides functions to load and save application settings
from/to a JSON configuration file.
"""

import json
import os

CONFIG_FILE = "config.json"
DEFAULT_CONFIG = {
    "labeler_name": "labeler1",
    "labels_directory": "labels",
    "data_folder": ".",
    "version": "1.0"
}

def load_config():
    """Load configuration from config.json, create with defaults if missing.

    Returns:
        dict: Configuration dictionary with all settings
    """
    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    try:
        with open(CONFIG_FILE, 'r') as f:
            config = json.load(f)
            # Merge with defaults for any missing keys
            return {**DEFAULT_CONFIG, **config}
    except Exception as e:
        print(f"Error loading config: {e}, using defaults")
        return DEFAULT_CONFIG.copy()

def save_config(config):
    """Save configuration to config.json.

    Args:
        config (dict): Configuration dictionary to save

    Returns:
        bool: True if save successful, False otherwise
    """
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving config: {e}")
        return False

def get_config_value(key, default=None):
    """Get a single config value.

    Args:
        key (str): Configuration key to retrieve
        default: Default value if key not found

    Returns:
        Configuration value or default
    """
    config = load_config()
    return config.get(key, default)

def set_config_value(key, value):
    """Set a single config value and save.

    Args:
        key (str): Configuration key to set
        value: Value to set

    Returns:
        bool: True if save successful, False otherwise
    """
    config = load_config()
    config[key] = value
    return save_config(config)
