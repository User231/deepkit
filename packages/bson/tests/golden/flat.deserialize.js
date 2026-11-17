// externals: isSignedNumericString_0, String_0, Number_0, fn_0, stringifyValueWithType_0, validationErrorCreate_0, validationErrorCreate_1
'use strict';
return function(v0,v1){
var v2=(v1??{});
var v3=undefined;
if("object"===typeof v0&&null!==v0){
    var v4=false;
    if(v2.loosely!==false&&"string"===typeof v0.id){
        v4=isSignedNumericString_0(v0.id);
    }
    var v5=v0.name;
    if(v2.loosely!==false&&("number"===typeof v0.name||"boolean"===typeof v0.name||"bigint"===typeof v0.name)){
        v5=String_0(v0.name);
    }
    var v6=v0.active;
    if("boolean"===typeof v0.active){
        v6=v0.active;
    }
    if(v2.loosely!==false&&!("boolean"===typeof v0.active)){
        if((v0.active==="true"||v0.active==="1"||v0.active===1)){
            v6=true;
        }
        if((v0.active==="false"||v0.active==="0"||v0.active===0)){
            v6=false;
        }
    }
    var v7={id:("number"===typeof v0.id?v0.id:(v2.loosely!==false&&"boolean"===typeof v0.id?(v0.id?1:0):(v4?Number_0(v0.id):v0.id))),name:v5,active:v6};
    if(("note" in v0)){
        if(null!=v0.note){
            var v8=v0.note;
            if(v2.loosely!==false&&("number"===typeof v0.note||"boolean"===typeof v0.note||"bigint"===typeof v0.note)){
                v8=String_0(v0.note);
            }
            v7.note=v8;
        }else{
            v7.note=undefined;
        }
    }
    if(("score" in v0)){
        if(null!=v0.score){
            var v9=undefined;
            var v10=false;
            if(!(v10)){
                if((v2.loosely!==false?("number"===typeof v0.score||"string"===typeof v0.score&&fn_0(v0.score)):"number"===typeof v0.score)){
                    var v11=false;
                    if(v2.loosely!==false&&"string"===typeof v0.score){
                        v11=isSignedNumericString_0(v0.score);
                    }
                    v9=("number"===typeof v0.score?v0.score:(v2.loosely!==false&&"boolean"===typeof v0.score?(v0.score?1:0):(v11?Number_0(v0.score):v0.score)));
                    v10=true;
                }
            }
            if(!(v10)){
                if(v0.score==null){
                    v9=null;
                    v10=true;
                }
            }
            if(v2.loosely!==false){
                if(!(v10)){
                    if(v0.score==null){
                        v9=null;
                        v10=true;
                    }
                }
            }
            if(!(v10)){
                var v12=[];
                v12.push({code:"type",path:"score",message:("Cannot convert "+stringifyValueWithType_0(v0.score)+" to "+"number | null"+". No union member matches")});
                throw validationErrorCreate_0(v12);
            }
            v7.score=v9;
        }else{
            v7.score=null;
        }
    }else{
        v7.score=null;
    }
    v3=v7;
}else{
    var v13=[];
    v13.push({code:"type",path:"",message:("Cannot convert "+stringifyValueWithType_0(v0)+" to "+"Flat"+"")});
    throw validationErrorCreate_1(v13);
}
return v3;
}
