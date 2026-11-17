// externals: String_0, stringifyValueWithType_0, validationErrorCreate_0
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=v0.name;
if(v2.loosely!==false&&("number"===typeof v0.name||"boolean"===typeof v0.name||"bigint"===typeof v0.name)){
    v3=String_0(v0.name);
}
var v4={id:v0.id,name:v3,active:v0.active};
if(("note" in v0)){
    v4.note=(v0.note==null?null:v0.note);
}
if(null!=v0.score){
    var v5=undefined;
    var v6=false;
    if(!(v6)){
        if("number"===typeof v0.score){
            v5=v0.score;
            v6=true;
        }
    }
    if(!(v6)){
        if(v0.score==null){
            v5=null;
            v6=true;
        }
    }
    if(false){
        if(!(v6)){
            if(v0.score==null){
                v5=null;
                v6=true;
            }
        }
    }
    if(!(v6)){
        var v7=[];
        v7.push({code:"type",path:"score",message:("Cannot convert "+stringifyValueWithType_0(v0.score)+" to "+"number | null"+". No union member matches")});
        throw validationErrorCreate_0(v7);
    }
    v4.score=v5;
}else{
    v4.score=null;
}
return v4;
}
