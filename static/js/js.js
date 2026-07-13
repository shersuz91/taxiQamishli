var bookForm = document.getElementById("bookForm")
var circles =document.querySelectorAll(".circle")
var sendingLoad = document.getElementById("sendingLoad")
var delay = 0
circles.forEach(circle=>{
    circle.style.backgroundColor = circle.getAttribute("color_")
    circle.style.animationDelay = delay+"s"
    delay+=.1
})
bookForm.addEventListener("submit", function(event){
    sendingLoad.style.display="flex";
})
