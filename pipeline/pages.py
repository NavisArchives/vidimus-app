"""The pages every review script works on: the scraped site, block for block."""
import project


def load():
    return project.load_json("scraped.json")
