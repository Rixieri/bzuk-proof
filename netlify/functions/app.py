import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from flask import Flask, request
import json

# Seu app Flask
app = Flask(__name__)

@app.route('/')
def home():
    return "Hello from Flask on Netlify!"

def lambda_handler(event, context):
    from flask import Response
    with app.app_context():
        response = app.full_dispatch_request()
        return {
            'statusCode': response.status_code,
            'headers': dict(response.headers),
            'body': response.get_data().decode('utf-8')
        }