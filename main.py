from flask import Flask, render_template, url_for, redirect, request, flash,send_file


import requests

TOKEN = "8880623007:AAHhPs56Ldqvelf1gxlXp1RFQzDQO3mgzUQ"
url_ = f"https://api.telegram.org/bot{TOKEN}/getUpdates"
url_Send = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
respons = requests.get(url_)


app = Flask(__name__)
app.secret_key = "sher"

@app.route("/google7d1e8f356d6cefa8.html")
def google_verification():
    return send_file("google7d1e8f356d6cefa8.html")


@app.route("/robots.txt")
def robots():
    return send_file("robots.txt", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    return send_file("sitemap.xml", mimetype="application/xml")


@app.route("/")
def home(message = ""):
    return render_template("home.html")

@app.route("/book", methods=["POST"])
def book():
    name = request.form["name"]
    phone = request.form["phone"]
    from_ = request.form["fromPlace"]
    to_ = request.form["toPlace"]
    day = request.form["day"]
    note = request.form["note"]

    dataList = [name, phone, from_, to_, day, note]

    if not all(input for input in dataList[:-1]) :
        return render_template("home.html",message =  dataList, len_ = len)

    message = f"""🚕  حجز جديد
        الاسم: {name}
        الهاتف: {phone}
        من: {from_}
        الى: {to_}
        الوقت: {day}
        الملاحظات: {note}
    """
    
    response = requests.post(url = url_Send, data={
        "chat_id":8759699913,
        "text":message
    })
    flash("تم حجز موعدك. سيصل فريقنا باسرع وقت ممكن.\nشكرا لصبركم!")
    return redirect(url_for("home"))

if __name__ == "__main__":
    app.run(debug = True) 