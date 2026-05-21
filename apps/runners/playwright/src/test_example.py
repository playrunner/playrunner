import os
import sys
import json
from datetime import datetime
from google.cloud import pubsub_v1
from playwright.sync_api import sync_playwright

TOPIC_NAME = 'orchestrator-logs'

# Initialize Pub/Sub Publisher (will use local fallback if no credentials)
try:
    publisher = pubsub_v1.PublisherClient()
    project_id = os.environ.get('GCP_PROJECT', 'local-dev')
    topic_path = publisher.topic_path(project_id, TOPIC_NAME)
except Exception as e:
    publisher = None

def publish_log(message, level='info'):
    log_msg = f"[Python Playwright] {message}"
    if publisher:
        try:
            payload = json.dumps({
                "message": log_msg,
                "level": level,
                "timestamp": datetime.utcnow().isoformat()
            }).encode("utf-8")
            publisher.publish(topic_path, data=payload)
        except Exception:
            print(f"[Local Fallback] {log_msg}")
    else:
        print(f"[Local Fallback] {log_msg}")

def run_test():
    publish_log("Starting Python Playwright execution...")
    
    with sync_playwright() as p:
        publish_log("Launching Chromium...")
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        publish_log("Navigating to example.com...")
        page.goto("https://example.com")
        
        title = page.title()
        publish_log(f"Page title is: {title}")
        
        browser.close()
        publish_log("Browser closed. Python execution complete.")

if __name__ == "__main__":
    try:
        run_test()
        sys.exit(0)
    except Exception as e:
        publish_log(f"Python Execution Error: {str(e)}", "error")
        sys.exit(1)
