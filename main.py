import math
import os
import secrets
from datetime import datetime, time
from decimal import Decimal, InvalidOperation

import click
import requests
from dotenv import load_dotenv
from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash


PROJECT_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATABASE_PATH = os.path.join(PROJECT_DIRECTORY, "instance", "taxi.db")
CURRENCY_LABEL = "ل.س"
load_dotenv(os.path.join(PROJECT_DIRECTORY, ".env"))

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("FLASK_SECRET_KEY") or secrets.token_urlsafe(32),
    SQLALCHEMY_DATABASE_URI=os.environ.get(
        "DATABASE_URL",
        f"sqlite:///{DEFAULT_DATABASE_PATH}",
    ),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    TELEGRAM_BOT_TOKEN=os.environ.get("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID=os.environ.get("TELEGRAM_CHAT_ID", "8759699913"),
    OSRM_BASE_URL=os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org"),
    BASE_FARE=float(os.environ.get("TAXI_BASE_FARE", "2.00")),
    PRICE_PER_KM=float(os.environ.get("TAXI_PRICE_PER_KM", "1.00")),
    MINIMUM_FARE=float(os.environ.get("TAXI_MINIMUM_FARE", "3.00")),
    ADDITIONAL_FEE=float(os.environ.get("TAXI_ADDITIONAL_FEE", "0.00")),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true",
)
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "admin_login"
login_manager.login_message = "يرجى تسجيل الدخول للوصول إلى لوحة الإدارة."


class Admin(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


class BusinessSettings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    base_fare = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("2.00"))
    price_per_km = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("1.00"))
    minimum_fare = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("3.00"))
    additional_fee = db.Column(db.Numeric(10, 2), nullable=False, default=Decimal("0.00"))
    service_center_latitude = db.Column(db.Float, nullable=False, default=37.052)
    service_center_longitude = db.Column(db.Float, nullable=False, default=41.218)
    service_radius_km = db.Column(db.Float, nullable=False, default=100.0)
    bookings_enabled = db.Column(db.Boolean, nullable=False, default=True)
    service_hours_enabled = db.Column(db.Boolean, nullable=False, default=False)
    service_start_time = db.Column(db.Time, nullable=True)
    service_end_time = db.Column(db.Time, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class Booking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_name = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(60), nullable=False)
    pickup_address = db.Column(db.Text, nullable=False)
    destination_address = db.Column(db.Text, nullable=False)
    pickup_latitude = db.Column(db.Float, nullable=False)
    pickup_longitude = db.Column(db.Float, nullable=False)
    destination_latitude = db.Column(db.Float, nullable=False)
    destination_longitude = db.Column(db.Float, nullable=False)
    distance_km = db.Column(db.Float, nullable=False)
    estimated_minutes = db.Column(db.Integer, nullable=False)
    estimated_fare = db.Column(db.Numeric(10, 2), nullable=False)
    base_fare_used = db.Column(db.Numeric(10, 2), nullable=False)
    price_per_km_used = db.Column(db.Numeric(10, 2), nullable=False)
    minimum_fare_used = db.Column(db.Numeric(10, 2), nullable=False)
    requested_for = db.Column(db.String(40), nullable=False)
    note = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="pending")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)


class SettingAudit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admin.id"), nullable=False)
    setting_name = db.Column(db.String(80), nullable=False)
    old_value = db.Column(db.String(255), nullable=False)
    new_value = db.Column(db.String(255), nullable=False)
    changed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)


@login_manager.user_loader
def load_admin(admin_id):
    return db.session.get(Admin, int(admin_id))


def get_settings():
    settings = db.session.get(BusinessSettings, 1)
    if settings is None:
        settings = BusinessSettings(
            id=1,
            base_fare=Decimal(str(app.config["BASE_FARE"])),
            price_per_km=Decimal(str(app.config["PRICE_PER_KM"])),
            minimum_fare=Decimal(str(app.config["MINIMUM_FARE"])),
            additional_fee=Decimal(str(app.config["ADDITIONAL_FEE"])),
        )
        db.session.add(settings)
        db.session.commit()
    return settings


def initialize_database():
    os.makedirs(app.instance_path, exist_ok=True)
    with app.app_context():
        db.create_all()
        get_settings()


initialize_database()


def calculate_fare(distance_km):
    """Return the configurable estimate for a verified driving distance."""
    settings = get_settings()
    fare = (
        settings.base_fare
        + (Decimal(str(distance_km)) * settings.price_per_km)
        + settings.additional_fee
    )
    return max(fare, settings.minimum_fare).quantize(Decimal("0.01"))


def distance_between_km(first_latitude, first_longitude, second_latitude, second_longitude):
    earth_radius_km = 6371.0088
    latitude_difference = math.radians(second_latitude - first_latitude)
    longitude_difference = math.radians(second_longitude - first_longitude)
    first_latitude_radians = math.radians(first_latitude)
    second_latitude_radians = math.radians(second_latitude)
    value = (
        math.sin(latitude_difference / 2) ** 2
        + math.cos(first_latitude_radians)
        * math.cos(second_latitude_radians)
        * math.sin(longitude_difference / 2) ** 2
    )
    return earth_radius_km * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def service_is_open(settings, current_time=None):
    if not settings.bookings_enabled:
        return False, "الحجز عبر الإنترنت غير متاح حالياً."
    if not settings.service_hours_enabled:
        return True, None

    current_time = current_time or datetime.now().time()
    if not settings.service_start_time or not settings.service_end_time:
        return False, "ساعات الخدمة غير مكتملة. يرجى التواصل مع الإدارة."
    if settings.service_start_time <= settings.service_end_time:
        is_open = settings.service_start_time <= current_time <= settings.service_end_time
    else:
        is_open = current_time >= settings.service_start_time or current_time <= settings.service_end_time
    return is_open, None if is_open else "الحجز غير متاح خارج ساعات الخدمة الحالية."


def validate_pickup_service_area(pickup_latitude, pickup_longitude, settings):
    pickup_distance = distance_between_km(
        pickup_latitude,
        pickup_longitude,
        settings.service_center_latitude,
        settings.service_center_longitude,
    )
    if pickup_distance > settings.service_radius_km:
        raise ValueError("نعتذر، خدمة الانطلاق متاحة حالياً ضمن منطقة الخدمة فقط.")


def require_csrf_token():
    token = request.form.get("csrf_token", "")
    if not token or not secrets.compare_digest(token, session.get("csrf_token", "")):
        abort(400, "رمز الحماية غير صالح. أعد تحميل الصفحة وحاول مرة أخرى.")


def parse_non_negative_decimal(value, field_name):
    try:
        decimal_value = Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{field_name} يجب أن يكون رقماً صالحاً.")
    if not decimal_value.is_finite() or decimal_value < 0:
        raise ValueError(f"{field_name} يجب أن يكون صفراً أو أكبر.")
    return decimal_value.quantize(Decimal("0.01"))


def parse_time_value(value, field_name):
    try:
        return time.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} غير صالح.")


def record_setting_change(settings, setting_name, new_value):
    old_value = str(getattr(settings, setting_name))
    new_value_text = str(new_value)
    if old_value != new_value_text:
        db.session.add(
            SettingAudit(
                admin_id=current_user.id,
                setting_name=setting_name,
                old_value=old_value,
                new_value=new_value_text,
            )
        )
        setattr(settings, setting_name, new_value)


@app.context_processor
def inject_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return {"csrf_token": session["csrf_token"]}


@app.cli.command("create-admin")
def create_admin():
    """Create the first administrator from ADMIN_USERNAME and ADMIN_PASSWORD."""
    username = os.environ.get("ADMIN_USERNAME", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if len(username) < 3:
        raise click.ClickException("ADMIN_USERNAME must contain at least 3 characters.")
    if len(password) < 12:
        raise click.ClickException("ADMIN_PASSWORD must contain at least 12 characters.")
    if Admin.query.first() is not None:
        raise click.ClickException("An administrator already exists; no account was created.")

    db.session.add(Admin(username=username, password_hash=generate_password_hash(password)))
    db.session.commit()
    click.echo("Initial administrator account created.")


@app.cli.command("reset-admin-password")
@click.option("--username", default=None, help="Existing administrator username.")
def reset_admin_password(username):
    """Reset an existing administrator password without storing it in source code."""
    username = (username or os.environ.get("ADMIN_USERNAME", "")).strip()
    if not username:
        username = click.prompt("Administrator username")
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not password:
        password = click.prompt("New password", hide_input=True, confirmation_prompt=True)
    if len(username) < 3:
        raise click.ClickException("ADMIN_USERNAME must contain at least 3 characters.")
    if len(password) < 12:
        raise click.ClickException("ADMIN_PASSWORD must contain at least 12 characters.")

    admin = Admin.query.filter_by(username=username).first()
    if admin is None:
        raise click.ClickException("No administrator exists with that username.")
    admin.password_hash = generate_password_hash(password)
    db.session.commit()
    click.echo("Administrator password reset.")


def parse_coordinate(value, coordinate_name, minimum, maximum):
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{coordinate_name} غير صالح.")

    if not math.isfinite(coordinate) or not minimum <= coordinate <= maximum:
        raise ValueError(f"{coordinate_name} غير صالح.")
    return coordinate


def get_driving_route(pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, include_geometry=False):
    coordinates = f"{pickup_longitude},{pickup_latitude};{destination_longitude},{destination_latitude}"
    route_url = f"{app.config['OSRM_BASE_URL'].rstrip('/')}/route/v1/driving/{coordinates}"
    try:
        response = requests.get(
            route_url,
            params={
                "overview": "full" if include_geometry else "false",
                "geometries": "geojson" if include_geometry else None,
            },
            timeout=10,
        )
        response.raise_for_status()
        route = response.json().get("routes", [])[0]
        distance_km = float(route["distance"]) / 1000
        duration_minutes = max(1, round(float(route["duration"]) / 60))
    except (requests.RequestException, IndexError, KeyError, TypeError, ValueError):
        raise ValueError("تعذر حساب مسار قيادة صالح. يرجى اختيار نقطتين مختلفتين والمحاولة مرة أخرى.")

    if not math.isfinite(distance_km) or distance_km <= 0:
        raise ValueError("مسافة الرحلة غير صالحة.")
    return {
        "distance_km": round(distance_km, 1),
        "estimated_minutes": duration_minutes,
        "geometry": route.get("geometry") if include_geometry else None,
    }


def send_telegram_booking(message):
    token = app.config["TELEGRAM_BOT_TOKEN"]
    if not token:
        app.logger.warning("Telegram notification skipped: TELEGRAM_BOT_TOKEN is not configured.")
        return

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data={"chat_id": app.config["TELEGRAM_CHAT_ID"], "text": message},
            timeout=10,
        ).raise_for_status()
    except requests.RequestException:
        app.logger.exception("Telegram notification failed.")

@app.route("/google7d1e8f356d6cefa8.html")
def google_verification():
    return send_file("google7d1e8f356d6cefa8.html")


@app.route("/robots.txt")
def robots():
    return send_file("robots.txt", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap():
    return send_file("sitemap.xml", mimetype="application/xml")


def render_home(message=None):
    settings = get_settings()
    is_open, availability_message = service_is_open(settings)
    return render_template(
        "home.html",
        message=message,
        booking_enabled=is_open,
        availability_message=availability_message,
        service_area={
            "center_latitude": settings.service_center_latitude,
            "center_longitude": settings.service_center_longitude,
            "radius_km": settings.service_radius_km,
        },
    )


@app.route("/")
def home():
    return render_home()


@app.route("/booking-config")
def booking_config():
    settings = get_settings()
    is_open, availability_message = service_is_open(settings)
    return jsonify(
        bookings_enabled=is_open,
        availability_message=availability_message,
        service_area={
            "center_latitude": settings.service_center_latitude,
            "center_longitude": settings.service_center_longitude,
            "radius_km": settings.service_radius_km,
        },
    )

@app.route("/admin/login", methods=["GET", "POST"])
def admin_login():
    if current_user.is_authenticated:
        return redirect(url_for("admin_dashboard"))

    if request.method == "POST":
        
        require_csrf_token()
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        admin = Admin.query.filter_by(username=username).first()
        if admin is None or not check_password_hash(admin.password_hash, password):
            flash("اسم المستخدم أو كلمة المرور غير صحيحة.")
            return render_template("admin_login.html")

        session.clear()
        login_user(admin)
        session["csrf_token"] = secrets.token_urlsafe(32)
        flash("تم تسجيل الدخول بنجاح.")
        return redirect(url_for("admin_dashboard"))
    return render_template("admin_login.html")


@app.route("/admin/logout", methods=["POST"])
@login_required
def admin_logout():
    require_csrf_token()
    logout_user()
    session.clear()
    flash("تم تسجيل الخروج.")
    return redirect(url_for("admin_login"))


@app.route("/admin/dashboard")
@login_required
def admin_dashboard():
    today_start = datetime.combine(datetime.today().date(), time.min)
    today_bookings = Booking.query.filter(Booking.created_at >= today_start).all()
    pending_bookings = Booking.query.filter_by(status="pending").count()
    completed_bookings = Booking.query.filter_by(status="completed").count()
    cancelled_bookings = Booking.query.filter_by(status="cancelled").count()
    today_revenue = sum((booking.estimated_fare for booking in today_bookings), Decimal("0.00"))
    return render_template(
        "admin_dashboard.html",
        settings=get_settings(),
        stats={
            "today": len(today_bookings),
            "pending": pending_bookings,
            "completed": completed_bookings,
            "cancelled": cancelled_bookings,
            "revenue": today_revenue,
        },
        audits=SettingAudit.query.order_by(SettingAudit.changed_at.desc()).limit(8).all(),
    )


@app.route("/admin/pricing", methods=["GET", "POST"])
@login_required
def admin_pricing():
    settings = get_settings()
    if request.method == "POST":
        require_csrf_token()
        try:
            values = {
                "base_fare": parse_non_negative_decimal(request.form.get("base_fare"), "الأجرة الأساسية"),
                "price_per_km": parse_non_negative_decimal(request.form.get("price_per_km"), "السعر لكل كم"),
                "minimum_fare": parse_non_negative_decimal(request.form.get("minimum_fare"), "الحد الأدنى للأجرة"),
                "additional_fee": parse_non_negative_decimal(request.form.get("additional_fee"), "الرسوم الإضافية"),
            }
            for setting_name, value in values.items():
                record_setting_change(settings, setting_name, value)
            db.session.commit()
            flash("تم حفظ إعدادات التسعير.")
            return redirect(url_for("admin_pricing"))
        except ValueError as error:
            flash(str(error))
    return render_template("admin_pricing.html", settings=settings)


@app.route("/admin/service-area", methods=["GET", "POST"])
@login_required
def admin_service_area():
    settings = get_settings()
    if request.method == "POST":
        require_csrf_token()
        try:
            latitude = parse_coordinate(request.form.get("service_center_latitude"), "خط عرض المركز", -90, 90)
            longitude = parse_coordinate(request.form.get("service_center_longitude"), "خط طول المركز", -180, 180)
            radius = float(request.form.get("service_radius_km"))
            if not math.isfinite(radius) or radius <= 0:
                raise ValueError("نصف قطر الخدمة يجب أن يكون أكبر من صفر.")
            record_setting_change(settings, "service_center_latitude", latitude)
            record_setting_change(settings, "service_center_longitude", longitude)
            record_setting_change(settings, "service_radius_km", round(radius, 2))
            db.session.commit()
            flash("تم حفظ منطقة الخدمة.")
            return redirect(url_for("admin_service_area"))
        except (TypeError, ValueError) as error:
            flash(str(error))
    return render_template("admin_service_area.html", settings=settings)


@app.route("/admin/general", methods=["GET", "POST"])
@login_required
def admin_general():
    settings = get_settings()
    if request.method == "POST":
        require_csrf_token()
        try:
            bookings_enabled = request.form.get("bookings_enabled") == "on"
            service_hours_enabled = request.form.get("service_hours_enabled") == "on"
            start_time = None
            end_time = None
            if service_hours_enabled:
                start_time = parse_time_value(request.form.get("service_start_time"), "وقت بدء الخدمة")
                end_time = parse_time_value(request.form.get("service_end_time"), "وقت انتهاء الخدمة")
            record_setting_change(settings, "bookings_enabled", bookings_enabled)
            record_setting_change(settings, "service_hours_enabled", service_hours_enabled)
            record_setting_change(settings, "service_start_time", start_time)
            record_setting_change(settings, "service_end_time", end_time)
            db.session.commit()
            flash("تم حفظ الإعدادات العامة.")
            return redirect(url_for("admin_general"))
        except ValueError as error:
            flash(str(error))
    return render_template("admin_general.html", settings=settings)


@app.route("/admin/bookings")
@login_required
def admin_bookings():
    return render_template(
        "admin_bookings.html",
        bookings=Booking.query.order_by(Booking.created_at.desc()).all(),
        statuses=("pending", "confirmed", "completed", "cancelled"),
    )


@app.route("/admin/bookings/<int:booking_id>/status", methods=["POST"])
@login_required
def update_booking_status(booking_id):
    require_csrf_token()
    booking = db.session.get(Booking, booking_id)
    status = request.form.get("status", "")
    if booking is None:
        abort(404)
    if status not in {"pending", "confirmed", "completed", "cancelled"}:
        abort(400, "حالة الحجز غير صالحة.")
    booking.status = status
    db.session.commit()
    flash("تم تحديث حالة الحجز.")
    return redirect(url_for("admin_bookings"))


@app.route("/route-estimate", methods=["POST"])
def route_estimate():
    data = request.get_json(silent=True) or {}
    try:
        settings = get_settings()
        is_open, availability_message = service_is_open(settings)
        if not is_open:
            raise ValueError(availability_message)
        pickup_latitude = parse_coordinate(data.get("pickup_latitude"), "إحداثي الانطلاق", -90, 90)
        pickup_longitude = parse_coordinate(data.get("pickup_longitude"), "إحداثي الانطلاق", -180, 180)
        destination_latitude = parse_coordinate(data.get("destination_latitude"), "إحداثي الوجهة", -90, 90)
        destination_longitude = parse_coordinate(data.get("destination_longitude"), "إحداثي الوجهة", -180, 180)
        validate_pickup_service_area(pickup_latitude, pickup_longitude, settings)
        route = get_driving_route(
            pickup_latitude,
            pickup_longitude,
            destination_latitude,
            destination_longitude,
            include_geometry=True,
        )
        route["estimated_fare"] = float(calculate_fare(route["distance_km"]))
        return jsonify(route)
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.route("/book", methods=["POST"])
def book():
    require_csrf_token()
    name = request.form.get("name", "").strip()
    phone = request.form.get("phone", "").strip()
    from_ = request.form.get("fromPlace", "").strip()
    to_ = request.form.get("toPlace", "").strip()
    day = request.form.get("day", "").strip()
    note = request.form.get("note", "").strip()

    dataList = [name, phone, from_, to_, day, note]

    if not all(value for value in dataList[:-1]):
        flash("يرجى تعبئة جميع الحقول المطلوبة واختيار نقطتي الرحلة من الخريطة.")
        return render_home(dataList)

    try:
        settings = get_settings()
        is_open, availability_message = service_is_open(settings)
        if not is_open:
            raise ValueError(availability_message)
        pickup_latitude = parse_coordinate(request.form.get("pickup_latitude"), "إحداثي الانطلاق", -90, 90)
        pickup_longitude = parse_coordinate(request.form.get("pickup_longitude"), "إحداثي الانطلاق", -180, 180)
        destination_latitude = parse_coordinate(request.form.get("destination_latitude"), "إحداثي الوجهة", -90, 90)
        destination_longitude = parse_coordinate(request.form.get("destination_longitude"), "إحداثي الوجهة", -180, 180)
        validate_pickup_service_area(pickup_latitude, pickup_longitude, settings)
        route = get_driving_route(
            pickup_latitude,
            pickup_longitude,
            destination_latitude,
            destination_longitude,
        )
        distance_km = route["distance_km"]
        estimated_minutes = route["estimated_minutes"]
        estimated_fare = calculate_fare(distance_km)
    except ValueError as error:
        flash(str(error))
        return render_home(dataList)

    message = f"""🚕  حجز جديد
الاسم: {name}
الهاتف: {phone}
الوقت: {day}
الملاحظات: {note or 'لا توجد'}

    ملخص الرحلة
    ------------
    نقطة الانطلاق: {from_}
    الوجهة: {to_}
المسافة: {distance_km:.1f} كم
الوقت التقديري: {estimated_minutes} دقيقة
الأجرة التقديرية: {estimated_fare:.2f} {CURRENCY_LABEL}

إحداثيات الانطلاق: {pickup_latitude:.6f}, {pickup_longitude:.6f}
إحداثيات الوجهة: {destination_latitude:.6f}, {destination_longitude:.6f}
    """

    booking = Booking(
        customer_name=name,
        phone=phone,
        pickup_address=from_,
        destination_address=to_,
        pickup_latitude=pickup_latitude,
        pickup_longitude=pickup_longitude,
        destination_latitude=destination_latitude,
        destination_longitude=destination_longitude,
        distance_km=distance_km,
        estimated_minutes=estimated_minutes,
        estimated_fare=estimated_fare,
        base_fare_used=settings.base_fare,
        price_per_km_used=settings.price_per_km,
        minimum_fare_used=settings.minimum_fare,
        requested_for=day,
        note=note,
    )
    db.session.add(booking)
    db.session.commit()
    send_telegram_booking(message)
    flash("تم حجز موعدك. سيصل فريقنا باسرع وقت ممكن.\nشكرا لصبركم!")
    return redirect(url_for("home"))

if __name__ == "__main__":
    app.run(debug = True) 