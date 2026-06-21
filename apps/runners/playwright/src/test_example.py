import os
import sys
from playwright.sync_api import sync_playwright

def publish_log(message, level='info'):
    log_msg = f"[Python Playwright] {message}"
    print(f"[Local Output] {log_msg}")

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
